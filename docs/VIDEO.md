# Accord motion demo

The 78-second video combines animated offer cards and accounting diagrams with captures of the deployed consumer app, exchange, and Stripe sandbox receipt. It visualizes a previously recorded live GPT auction; it is not a continuous screen recording or a new auction. Persistent labels identify the recorded run and sandbox money.

Local exports in `artifacts/demo-video/`:

- `Accord-demo.mp4`: 1920×1080, 24 fps, H.264, narrated with the system Samantha voice, plus an English subtitle track.
- `Accord-demo-silent.mp4`: the same motion design without narration, suitable for a live pitch.
- `Accord-demo.srt`: separate subtitles.
- `poster.png`: the final bid comparison.

All five completed rounds come from `test-results/dating-consumer-sandbox.json`. The lower cash bidder wins through fit and effective price: Ritual bids $0.90 against Blue Bottle's $1.80, offers $4.50 off, and earns a 60.450 user score. The recorded click produced a verified $0.72 publisher transfer and $0.18 network gross. Campaigns, basket quotes, and codes are fictional; codes are illustrative.

The editable storyboard and narration are in [VIDEO-SCRIPT.md](VIDEO-SCRIPT.md). The rendering scripts do not change or deploy the application.

To regenerate on this Mac, retain the local recorded auction and `consumer.png`, `exchange.png`, and `receipt.png` screenshots in the export directory, then run:

```sh
/Users/gautamjajoo/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/render-demo-video.py
python3 scripts/assemble-demo-video.py
```

The renderer uses Pillow, system fonts, and `/opt/local/bin/ffmpeg`. Audio assembly uses macOS `say` and FFmpeg. To change the narration, delete the corresponding generated `audio/scene-N.aiff` before reassembling.
