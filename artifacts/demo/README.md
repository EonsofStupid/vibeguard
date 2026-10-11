# VibeGuard walkthrough draft

`vibeguard-walkthrough-draft.mp4` is a narrated 63-second draft made from actual browser captures of the local Modelence production build on October 11, 2026. It uses real hosted Atlas and Agent Engine services. It does not represent verification of the updated cloud deployment.

The three scenes show acknowledged chat turns and recalled project context, the measured cooldown proposal, and the actual pending RRFlow human review. Narration is synthesized from `narration.txt`; the screen captures have not been altered to manufacture results. The video and audio are local artifacts excluded from Git.

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
