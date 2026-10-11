# VibeGuard walkthrough draft

## Prepared 58-second version

`storyboard.json` defines a 58-second version with separate scenes for real chat,
contextual learning, incident replay, human review and the final runtime view.
`narration.txt`, `captions.srt` and `spoken-captions.srt` are generated from that
single source. The narration is synthesized locally; the longest required speed
adjustment is currently 1.11x, and speech is never cut off to meet the time limit.

Final rendering is deliberately held until the new popup and runtime captures
are supplied. `final_captures_ready` is false. The final runtime scene has no
Raindrop success claim pending actual trace evidence. Human review remains
pending in both the narration and captions. The evaluation explicitly describes
8 -> 0 avoidable recalls and 51 retained turns as incident-derived simulation.

From the repository root:

```powershell
.\.tools\python\python.exe artifacts/demo/render_demo.py
.\.tools\python\python.exe artifacts/demo/render_demo.py --prepare-audio
# After supplying and verifying every screenshot in storyboard.json:
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
- Pending review: `../../rrflow/agents/rrflow/review-checkpoint.json`.
- Policy is proposed, not activated, in this recording. Provider behavior in the evaluation is replayed with simulated follow-up timings.

## Before the submission recording

1. Obtain the user's actual decision through RRFlow.
2. Independently verify the exact policy, version and approval receipt in Atlas.
3. Run and record the approved-policy rerun.
4. Verify the updated cloud deployment with a real chat and both memory receipts.
5. Capture the complete cycle from that deployed UI and record the user's narration on site as required by the event.

Do not submit this draft as proof of activation or a completed approved-version rerun.
