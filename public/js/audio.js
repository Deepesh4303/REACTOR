/**
 * Procedural Audio Synthesizer using Web Audio API
 * Generates crisp sci-fi laser zaps, placement blips, and UI feedback
 * without requiring external sound files.
 */

class SoundManager {
    constructor() {
        this.ctx = null;
        this.isMuted = localStorage.getItem('cr_sound_muted') === 'true';
        this.initOnInteraction();
    }

    /**
     * Lazily initialize or resume AudioContext on first user gesture
     */
    initOnInteraction() {
        const unlock = () => {
            if (!this.ctx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) {
                    this.ctx = new AudioContextClass();
                }
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        };

        window.addEventListener('click', unlock, { once: true, passive: true });
        window.addEventListener('keydown', unlock, { once: true, passive: true });
        window.addEventListener('touchstart', unlock, { once: true, passive: true });
    }

    ensureContext() {
        if (!this.ctx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                this.ctx = new AudioContextClass();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        localStorage.setItem('cr_sound_muted', this.isMuted ? 'true' : 'false');
        return this.isMuted;
    }

    setMuted(muted) {
        this.isMuted = !!muted;
        localStorage.setItem('cr_sound_muted', this.isMuted ? 'true' : 'false');
    }

    /**
     * Play a laser-like sound effect during explosions.
     * Escalates in pitch with chain reaction stages for dramatic tension!
     * 
     * @param {number} chainIndex - Order in the chain reaction (0 = first blast)
     */
    playLaserExplosion(chainIndex = 0) {
        if (this.isMuted) return;
        const ctx = this.ensureContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const duration = 0.16;

        // Base frequency steps up slightly with each cascading explosion
        const pitchMultiplier = 1 + Math.min(chainIndex * 0.12, 1.2);
        const startFreq = (1650 + Math.min(chainIndex * 110, 900)) * pitchMultiplier;
        const endFreq = 95 * pitchMultiplier;

        // 1. Primary oscillator: Sawtooth for that rich laser buzz
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

        // 2. Secondary oscillator: Triangle wave an octave lower for low-end punch
        const subOsc = ctx.createOscillator();
        subOsc.type = 'triangle';
        subOsc.frequency.setValueAtTime(startFreq * 0.5, now);
        subOsc.frequency.exponentialRampToValueAtTime(endFreq * 0.6, now + duration);

        // 3. Resonant filter sweep: classic laser "pew" formant
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.setValueAtTime(6.0, now);
        filter.frequency.setValueAtTime(Math.min(4500 * pitchMultiplier, 12000), now);
        filter.frequency.exponentialRampToValueAtTime(240, now + duration);

        // 4. Volume envelope with punchy attack and smooth snappy decay
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.38, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        // Connect synthesis graph
        osc.connect(filter);
        subOsc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        // 5. Crisp white noise burst at onset for laser bite
        try {
            const bufferSize = Math.floor(ctx.sampleRate * 0.025);
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
            }
            const whiteNoise = ctx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;

            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.setValueAtTime(3200, now);
            noiseFilter.Q.setValueAtTime(2, now);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.18, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

            whiteNoise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ctx.destination);

            whiteNoise.start(now);
            whiteNoise.stop(now + 0.03);
        } catch (e) {
            // Noise buffer fallback if unsupported
        }

        osc.start(now);
        subOsc.start(now);
        osc.stop(now + duration);
        subOsc.stop(now + duration);
    }

    /**
     * Soft pleasant pop/blip when a player successfully places a particle
     */
    playPlaceParticle() {
        if (this.isMuted) return;
        const ctx = this.ensureContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.exponentialRampToValueAtTime(380, now + 0.07);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.07);
    }

    /**
     * Subtle low buzz when trying to make an invalid move
     */
    playInvalidMove() {
        if (this.isMuted) return;
        const ctx = this.ensureContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.12);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.12);
    }

    /**
     * Victory fanfare chime
     */
    playVictory() {
        if (this.isMuted) return;
        const ctx = this.ensureContext();
        if (!ctx) return;

        const notes = [440, 554.37, 659.25, 880];
        const now = ctx.currentTime;

        notes.forEach((freq, i) => {
            const noteStart = now + i * 0.11;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, noteStart);

            gain.gain.setValueAtTime(0.001, noteStart);
            gain.gain.linearRampToValueAtTime(0.24, noteStart + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.35);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(noteStart);
            osc.stop(noteStart + 0.35);
        });
    }
}

// Global sound manager instance
window.soundManager = new SoundManager();
