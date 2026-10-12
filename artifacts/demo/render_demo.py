"""Prepare or render a measured <=60s walkthrough from unaltered browser captures.

Default: validate the storyboard and generate narration/caption/scene text only.
--prepare-audio: also synthesize local speech and report duration adjustments.
--render: require final_captures_ready and all capture files, then render 58s MP4.
No network requests, approval actions, or model calls are performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import wave


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FFMPEG = ROOT / ".tools/ffmpeg/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"


def run(args: list[str]) -> None:
    subprocess.run(args, cwd=HERE, check=True)


def stamp(seconds: float) -> str:
    millis = round(seconds * 1000)
    return f"{millis // 3600000:02}:{millis // 60000 % 60:02}:{millis // 1000 % 60:02},{millis % 1000:03}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-audio", action="store_true")
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    plan = json.loads((HERE / "storyboard.json").read_text(encoding="utf-8"))
    total = sum(scene["seconds"] for scene in plan["scenes"])
    assert 0 < total <= 60 and total == plan["target_seconds"]
    assert len({scene["id"] for scene in plan["scenes"]}) == len(plan["scenes"])
    start = 0
    captions, spoken, concat = [], [], []
    for index, scene in enumerate(plan["scenes"], 1):
        assert scene["seconds"] > 0
        end = start + scene["seconds"]
        captions.append(f"{index}\n{stamp(start)} --> {stamp(end)}\n{scene['caption']}\n")
        spoken.append(f"{index}\n{stamp(start)} --> {stamp(end)}\n{scene['narration']}\n")
        concat.append(f"file '{scene['image']}'\nduration {scene['seconds']}")
        start = end
    (HERE / "narration.txt").write_text("\n\n".join(scene["narration"] for scene in plan["scenes"]) + "\n", encoding="utf-8")
    (HERE / "captions.srt").write_text("\n".join(captions), encoding="utf-8")
    (HERE / "spoken-captions.srt").write_text("\n".join(spoken), encoding="utf-8")
    (HERE / "scenes.txt").write_text("\n".join(concat) + f"\nfile '{plan['scenes'][-1]['image']}'\n", encoding="utf-8")
    if not args.prepare_audio and not args.render:
        print(json.dumps({"seconds": total, "rendered": False, "final_captures_ready": plan["final_captures_ready"]}))
        return
    if args.render:
        assert plan["final_captures_ready"], "Final captures have not been supplied and verified."
        assert FFMPEG.is_file(), "Expected local ffmpeg executable is missing."
        for scene in plan["scenes"]:
            assert (HERE / scene["image"]).is_file(), f"Missing capture: {scene['image']}"
    run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HERE / "synthesize.ps1"), "-Storyboard", str(HERE / "storyboard.json"), "-OutputDirectory", str(HERE)])
    receipts = []
    for scene in plan["scenes"]:
        voice = HERE / f"voice-{scene['id']}.wav"
        with wave.open(str(voice)) as audio:
            voice_seconds = audio.getnframes() / audio.getframerate()
        # Leave a small tail; never truncate speech to force the duration claim.
        tempo = max(1.0, voice_seconds / (scene["seconds"] - 0.3))
        assert tempo <= 1.35, f"Shorten narration for {scene['id']}; speech would be too rushed ({tempo:.2f}x)."
        receipt = {"scene": scene["id"], "seconds": scene["seconds"], "voice_seconds": round(voice_seconds, 3), "tempo": round(tempo, 6)}
        receipts.append(receipt)
        if args.render:
            source = HERE / scene["image"]
            receipt["source_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
            run([str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-i", str(source), "-i", str(voice), "-vf", "scale=1920:900:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:20:color=0x0f1115,setsar=1", "-af", f"atempo={tempo:.8f},apad,atrim=duration={scene['seconds']}", "-t", str(scene["seconds"]), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", f"segment-{scene['id']}.mp4"])
    if args.render:
        (HERE / "segments.txt").write_text("\n".join(f"file 'segment-{scene['id']}.mp4'" for scene in plan["scenes"]) + "\n", encoding="utf-8")
        run([str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "segments.txt", "-i", "spoken-captions.srt", "-map", "0:v", "-map", "0:a", "-map", "1:0", "-vf", "subtitles=captions.srt:force_style='FontName=Arial,FontSize=10,PrimaryColour=&H00FFFFFF,OutlineColour=&H0015110F,BorderStyle=1,Outline=1,Alignment=2,MarginV=8'", "-t", str(total), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-movflags", "+faststart", "vibeguard-walkthrough.mp4"])
    report = {"target_seconds": total, "rendered": args.render, "evidence_environment": plan["capture_environment"], "policy_status": plan["policy_status"], "synthesized_narration": True, "scenes": receipts}
    if args.render:
        output = HERE / "vibeguard-walkthrough.mp4"
        inspection = subprocess.run([str(FFMPEG), "-hide_banner", "-i", str(output)], capture_output=True, text=True, encoding="utf-8", errors="replace")
        duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", inspection.stderr)
        assert duration, "Rendered file duration could not be independently inspected."
        actual_seconds = int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])
        assert 0 < actual_seconds <= 60, f"Rendered duration {actual_seconds} exceeds the submission limit."
        assert "Audio:" in inspection.stderr and "Subtitle:" in inspection.stderr, "Narration or subtitle stream is missing."
        report.update({"actual_seconds": actual_seconds, "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "output_bytes": output.stat().st_size, "audio_stream_verified": True, "subtitle_stream_verified": True})
    (HERE / "render-receipt.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
