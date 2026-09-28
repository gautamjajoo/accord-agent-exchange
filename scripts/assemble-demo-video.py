#!/usr/bin/env python3
"""Create timed narration, subtitles, and the final narrated demo MP4.

Run after render-demo-video.py, using macOS's built-in Samantha voice.
All narration comes from the reviewed VIDEO-SCRIPT.md storyboard.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/demo-video'
FFMPEG = '/opt/local/bin/ffmpeg'
FFPROBE = '/opt/local/bin/ffprobe'


def run(args):
    subprocess.run(args, check=True)


def duration(path):
    return float(subprocess.check_output([
        FFPROBE, '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(path)
    ]))


def stamp(value):
    milliseconds = round(value * 1000)
    return f'{milliseconds//3600000:02}:{milliseconds//60000%60:02}:{milliseconds//1000%60:02},{milliseconds%1000:03}'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'audio').mkdir(exist_ok=True)
    scenes = []
    for line in (ROOT / 'docs/VIDEO-SCRIPT.md').read_text().splitlines():
        if re.match(r'\| \d\d–\d\d \|', line):
            cells = [cell.strip() for cell in line.split('|')[1:-1]]
            start, end = map(int, cells[0].split('–'))
            scenes.append({'start': start, 'end': end, 'text': cells[2].strip('“”')})
    (OUT / 'narration.json').write_text(json.dumps(scenes, indent=2))
    inputs, filters, labels, subtitles = [], [], [], []
    for index, scene in enumerate(scenes):
        source = OUT / f'audio/scene-{index}.txt'
        source.write_text(scene['text'])
        speech = OUT / f'audio/scene-{index}.aiff'
        if not speech.exists():
            run(['say', '-v', 'Samantha', '-r', '170', '-f', str(source), '-o', str(speech)])
        inputs += ['-i', str(speech)]
        available = scene['end'] - scene['start'] - .7
        spoken = duration(speech)
        speed = max(1, spoken / available)
        delay = round((scene['start'] + .3) * 1000)
        filters.append(f'[{index}:a]atempo={speed:.5f},adelay={delay}|{delay}[voice{index}]')
        labels.append(f'[voice{index}]')
        # Short caption cues remain useful in players with subtitles enabled.
        sentences = re.split(r'(?<=[.!?])\s+', scene['text'])
        total_words = sum(len(sentence.split()) for sentence in sentences)
        cursor = scene['start'] + .3
        for sentence in sentences:
            length = (spoken / speed) * len(sentence.split()) / total_words
            subtitles.append(f'{len(subtitles)+1}\n{stamp(cursor)} --> {stamp(cursor+length)}\n{sentence}\n')
            cursor += length
    filters.append(''.join(labels) + f'amix=inputs={len(labels)}:normalize=0,apad,atrim=0:{scenes[-1]["end"]},loudnorm=I=-16:TP=-1.5:LRA=11[audio]')
    run([FFMPEG, '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(filters),
         '-map', '[audio]', '-ar', '48000', str(OUT / 'narration.wav')])
    (OUT / 'Accord-demo.srt').write_text('\n'.join(subtitles))
    silent = OUT / 'Accord-demo-silent.mp4'
    if not silent.exists():
        print('Narration and subtitles ready. Run again after the video render finishes.')
        return
    run([FFMPEG, '-y', '-loglevel', 'error', '-i', str(silent),
         '-i', str(OUT / 'narration.wav'), '-i', str(OUT / 'Accord-demo.srt'),
         '-map', '0:v:0', '-map', '1:a:0', '-map', '2:0', '-c:v', 'copy',
         '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text',
         '-metadata:s:s:0', 'language=eng', '-metadata', 'title=Accord — Better deals, by negotiation',
         '-movflags', '+faststart', '-t', str(scenes[-1]['end']), str(OUT / 'Accord-demo.mp4')])
    print('Final video:', OUT / 'Accord-demo.mp4')


if __name__ == '__main__':
    main()
