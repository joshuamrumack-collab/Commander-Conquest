import * as Tone from 'tone';

class NapoleonicAudioSystem {
  private initialized = false;
  private musicEnabled = true;
  private sfxEnabled = true;
  private intensity: 'normal' | 'stress' = 'normal';

  private melodySynth: Tone.PolySynth | null = null;
  private bassSynth: Tone.MonoSynth | null = null;
  private drumSynth: Tone.NoiseSynth | null = null;
  private drumLoop: Tone.Sequence | null = null;
  private melodyLoopNormal: Tone.Sequence | null = null;
  private melodyLoopStress: Tone.Sequence | null = null;

  // Dedicated SFX synths
  private musketNoise: Tone.NoiseSynth | null = null;
  private cannonNoise: Tone.NoiseSynth | null = null;
  private cannonSub: Tone.MembraneSynth | null = null;
  private trumpetSynth: Tone.PolySynth | null = null;
  private chimeSynth: Tone.PolySynth | null = null;

  async init() {
    if (this.initialized) return;
    try {
      await Tone.start();
      Tone.getTransport().bpm.value = 112;

      // Regal Imperial Fanfare Synth
      this.melodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.04, decay: 0.25, sustain: 0.4, release: 0.3 }
      }).toDestination();
      this.melodySynth.volume.value = -14;

      // Marching Imperial Bass
      this.bassSynth = new Tone.MonoSynth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.2 }
      }).toDestination();
      this.bassSynth.volume.value = -8;

      // Napoleonic Field Snare Drum
      this.drumSynth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.003, decay: 0.12, sustain: 0, release: 0.08 }
      }).toDestination();
      this.drumSynth.volume.value = -12;

      // SFX Instruments
      this.musketNoise = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }
      }).toDestination();
      this.musketNoise.volume.value = -10;

      this.cannonNoise = new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.005, decay: 0.45, sustain: 0, release: 0.3 }
      }).toDestination();
      this.cannonNoise.volume.value = -6;

      this.cannonSub = new Tone.MembraneSynth({
        pitchDecay: 0.08,
        octaves: 4,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 0.4 }
      }).toDestination();
      this.cannonSub.volume.value = -4;

      this.trumpetSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.2 }
      }).toDestination();
      this.trumpetSynth.volume.value = -10;

      this.chimeSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.5 }
      }).toDestination();
      this.chimeSynth.volume.value = -12;

      // Field Snare & Bass Sequence (Pas de Charge cadence)
      this.drumLoop = new Tone.Sequence((time, step) => {
        if (!this.musicEnabled) return;
        if (step % 4 === 0) {
          this.drumSynth?.triggerAttackRelease("16n", time, 1);
          this.bassSynth?.triggerAttackRelease("D2", "8n", time);
        } else if (step % 2 === 0) {
          this.drumSynth?.triggerAttackRelease("16n", time, 0.45);
        } else if (step === 3 || step === 7 || step === 11 || step === 15) {
          this.drumSynth?.triggerAttackRelease("32n", time, 0.3);
        }
      }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "16n");

      // Grand Armée Marching Hymn (Imperial Brass theme)
      const marchMelody = [
        ["D4", "F4"], null, ["A3", "D4"], null, ["D4", "F4"], null, ["A4", "D5"], null,
        ["G4", "Bb4"], null, null, null, ["F4", "A4"], null, ["E4", "G4"], null,
        ["D4", "F4"], null, ["C4", "E4"], null, ["D4", "F4"], null, ["A3", "D4"], null,
        ["A4", "D5"], null, null, null, ["F4", "A4"], null, ["D4", "F4"], null
      ];

      this.melodyLoopNormal = new Tone.Sequence((time, chord) => {
        if (!this.musicEnabled) return;
        if (chord && this.melodySynth) {
          this.melodySynth.triggerAttackRelease(chord as any, "8n", time);
        }
      }, marchMelody, "8n");

      // Urgent Charge / Battle of Austerlitz Climax Sequence
      const urgentMelody = [
        ["D4", "F4"], ["E4", "G4"], ["F4", "A4"], ["G4", "Bb4"],
        ["A4", "D5"], ["G4", "Bb4"], ["F4", "A4"], ["E4", "G4"],
        ["D4", "F4"], ["C#4", "E4"], ["D4", "F4"], ["F4", "A4"],
        ["Bb4", "D5"], ["A4", "C#5"], ["D5", "F5"], null
      ];

      this.melodyLoopStress = new Tone.Sequence((time, chord) => {
        if (!this.musicEnabled) return;
        if (chord && this.melodySynth) {
          this.melodySynth.triggerAttackRelease(chord as any, "8n", time);
        }
      }, urgentMelody, "8n");

      this.initialized = true;
    } catch {
      // Audio context might be restricted before user gesture
    }
  }

  isMusicOn() {
    return this.musicEnabled;
  }

  isSfxOn() {
    return this.sfxEnabled;
  }

  async toggleMusic(): Promise<boolean> {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicEnabled) {
      if (!this.initialized) await this.init();
      this.playMusic();
    } else {
      this.stopMusic();
    }
    return this.musicEnabled;
  }

  toggleSfx(): boolean {
    this.sfxEnabled = !this.sfxEnabled;
    return this.sfxEnabled;
  }

  playMusic() {
    if (!this.musicEnabled || !this.initialized) return;
    try {
      if (Tone.getContext().state !== 'running') {
        Tone.getContext().resume();
      }
      Tone.getTransport().start();
      this.drumLoop?.start(0);
      if (this.intensity === 'stress') {
        this.melodyLoopStress?.start(0);
      } else {
        this.melodyLoopNormal?.start(0);
      }
    } catch {
      // safe fallback
    }
  }

  stopMusic() {
    if (!this.initialized) return;
    try {
      Tone.getTransport().stop();
      this.drumLoop?.stop();
      this.melodyLoopNormal?.stop();
      this.melodyLoopStress?.stop();
    } catch {
      // safe fallback
    }
  }

  setIntensity(level: 'normal' | 'stress') {
    if (!this.initialized || !this.musicEnabled || this.intensity === level) return;
    this.intensity = level;
    try {
      if (level === 'stress') {
        Tone.getTransport().bpm.rampTo(140, 2);
        this.melodyLoopNormal?.stop();
        this.melodyLoopStress?.start(0);
      } else {
        Tone.getTransport().bpm.rampTo(112, 2);
        this.melodyLoopStress?.stop();
        this.melodyLoopNormal?.start(0);
      }
    } catch {
      // safe
    }
  }

  // SFX triggers
  playMusket() {
    if (!this.sfxEnabled || !this.initialized) return;
    try {
      const now = Tone.now();
      this.musketNoise?.triggerAttackRelease("16n", now);
    } catch {
      // ignore
    }
  }

  playCannon() {
    if (!this.sfxEnabled || !this.initialized) return;
    try {
      const now = Tone.now();
      this.cannonNoise?.triggerAttackRelease("8n", now);
      this.cannonSub?.triggerAttackRelease("C1", "4n", now);
    } catch {
      // ignore
    }
  }

  playRally() {
    if (!this.sfxEnabled || !this.initialized) return;
    try {
      const now = Tone.now();
      this.trumpetSynth?.triggerAttackRelease(["D4", "F#4", "A4"], "8n", now);
      this.trumpetSynth?.triggerAttackRelease(["A4", "D5", "F#5"], "4n", now + 0.15);
    } catch {
      // ignore
    }
  }

  playCapture() {
    if (!this.sfxEnabled || !this.initialized) return;
    try {
      const now = Tone.now();
      this.chimeSynth?.triggerAttackRelease(["E5", "B5", "E6"], "4n", now);
    } catch {
      // ignore
    }
  }

  playVictory() {
    if (!this.musicEnabled || !this.initialized) return;
    this.stopMusic();
    try {
      const now = Tone.now();
      this.trumpetSynth?.triggerAttackRelease(["D4", "A4"], "8n", now);
      this.trumpetSynth?.triggerAttackRelease(["F#4", "D5"], "8n", now + 0.15);
      this.trumpetSynth?.triggerAttackRelease(["A4", "F#5"], "8n", now + 0.3);
      this.trumpetSynth?.triggerAttackRelease(["D5", "A5", "D6"], "2n", now + 0.45);
    } catch {
      // ignore
    }
  }

  playDefeat() {
    if (!this.musicEnabled || !this.initialized) return;
    this.stopMusic();
    try {
      const now = Tone.now();
      this.trumpetSynth?.triggerAttackRelease(["G3", "D4"], "4n", now);
      this.trumpetSynth?.triggerAttackRelease(["Eb3", "Bb3"], "4n", now + 0.35);
      this.trumpetSynth?.triggerAttackRelease(["C3", "G3"], "2n", now + 0.7);
    } catch {
      // ignore
    }
  }
}

export const sound = new NapoleonicAudioSystem();
