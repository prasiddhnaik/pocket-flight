export const musicTracks = [
  {
    id: "coastlines",
    title: "Coastlines",
    bpm: 92,
    bars: 64,
    beatsPerBar: 4,
    key: "D major / B minor",
    description: "Warm keys, glass melody, coastal downtempo",
  },
  {
    id: "blue-hour",
    title: "Blue Hour",
    bpm: 72,
    bars: 48,
    beatsPerBar: 3,
    key: "E Dorian",
    description: "Electric piano, plucked strings, a nocturnal waltz",
  },
  {
    id: "sunward",
    title: "Sunward",
    bpm: 118,
    bars: 64,
    beatsPerBar: 4,
    key: "A major",
    description: "Analog arpeggios, wooden percussion, forward motion",
  },
] as const;

export type MusicTrack = (typeof musicTracks)[number];
export type MusicTrackId = MusicTrack["id"];
export function getMusicTrack(id: unknown): MusicTrack {
  return musicTracks.find((track) => track.id === id) ?? musicTracks[0];
}
export function trackDuration(track: MusicTrack) {
  return (
    Math.round(((track.bars * track.beatsPerBar * 60) / track.bpm) * 44100) /
    44100
  );
}
