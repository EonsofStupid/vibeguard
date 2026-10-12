# VibeGuard walkthrough

## Final version: 58.02 seconds

`vibeguard-walkthrough.mp4` is the final narrated walkthrough, inspected at
58.02 seconds, below the 60-second limit. It is 1,756,741 bytes; SHA-256:
`6681b497b5608c3bbaeb5a03e907951b06f6cd0dfe55c0f94aac5fdc1dd05982`.
The audio and subtitle streams are present. Extracted learning and review frames
were visually checked for readable captions and correct evidence labels.

`storyboard.json` defines a 58-second version with separate scenes for real chat,
contextual learning, incident replay, human review and the final runtime view.
`narration.txt`, `captions.srt` and `spoken-captions.srt` are generated from that
single source. The narration is synthesized locally; the longest required speed
adjustment is 1.19x, and speech is never cut off to meet the time limit.

The final captures are supplied and `final_captures_ready` is true. They show
the local production build on `localhost:53351` using real hosted services.
Raindrop acknowledged the displayed actual chat event with HTTP 200; the video
does not claim that its dashboard was inspected. The latest review status is a human
approval on the proposal with its matching audit receipt missing. Activation
is unverified, and the approved-version rerun remains pending. The current chat
discloses unavailable long-term recall and continues recording its turns. The
earlier independently verified chat did recall the project goal. The evaluation explicitly describes
8 -> 0 avoidable recalls and 51 retained turns as incident-derived simulation.

From the repository root:

```powershell
.\.tools\python\python.exe artifacts/demo/render_demo.py
.\.tools\python\python.exe artifacts/demo/render_demo.py --prepare-audio
# Reproduce the final video from the supplied captures:
.\.tools\python\python.exe artifacts/demo/render_demo.py --render
```

The last command requires `final_captures_ready: true`. It writes
`vibeguard-walkthrough.mp4`, burns in evidence labels, adds a selectable full
narration subtitle track, and records screenshot hashes and speech timing in
`render-receipt.json`. It makes no network, model or approval requests. Review
the rendered duration, scene boundaries and audio before submitting.

## Earlier 63-second draft

`vibeguard-walkthrough-draft.mp4` is a narrated 63-second draft made from actual browser captures of the local Modelence production build on October 11, 2026. It uses real hosted Atlas and Agent Engine services. It does not represent verification of the updated cloud deployment.

The three scenes show acknowledged chat turns and recalled project context, the measured cooldown proposal, and the actual pending RRFlow human review. Its original text assets are preserved as `narration-draft.txt`, `captions-draft.srt` and `scenes-draft.txt`; the screen captures have not been altered to manufacture results. The video and audio are local artifacts excluded from Git.

## Evidence

- Chat readback: `../modelence-chat-memory-checkpoint.json`.
- Experiment: `../improvement/context-replay-20261011T224404Z.json`.
- Historical pending review: `../../rrflow/agents/rrflow/review-checkpoint.json`.
- Current approval recorded / activation unverified state: `05-review-popup.png` (an RSI summary, despite the capture filename).
- Actual chat, Atlas receipt and Raindrop acknowledgement: `06-raindrop-trace.png`.
- Current contextual explanation popup: `04-context-popup.png`.
- Provider behavior in the evaluation is replayed with simulated follow-up timings. No completed approval/activation/rerun cycle is claimed in the final video.

## Remaining acceptance work

1. Reconcile the existing human decision with its missing audit receipt without fabricating approval.
2. Independently verify the exact policy, version and approval receipt in Atlas.
3. Run and record the approved-policy rerun.
4. Verify the updated cloud deployment with a real chat and both memory receipts.
5. Capture the complete cycle from that deployed UI and record the user's narration on site as required by the event.

Neither the earlier draft nor the final walkthrough is proof of activation or a completed approved-version rerun. The final video is a narrated local production walkthrough assembled from genuine browser captures, not a claim that the latest custom-domain deployment was verified.
