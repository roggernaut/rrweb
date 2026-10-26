---
"rrvideo": minor
---

Add an ffmpeg capture backend that plays the rrweb replayer on a virtual clock advanced one frame interval per captured frame (using `HeadlessExperimental.beginFrame` on headless Linux, screenshots elsewhere) and pipes JPEGs into libx264. Use this for high-fps / high-resolution MP4 export; Playwright `recordVideo` remains available but is still limited by CDP screencast (~25fps WebM). `transformMany` runs sessions in parallel.
