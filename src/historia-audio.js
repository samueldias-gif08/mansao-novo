"use strict";

const TRILHAS_HISTORIA = {
  quarto: { passo: 0.46, notas: [48, 55, 60, 64, 45, 52, 57, 60] },
  luta: { passo: 0.22, notas: [38, 38, 45, 38, 41, 38, 48, 43] },
  falha: { passo: 0.28, notas: [38, 39, 46, 38, 42, 43, 51, 49] },
  final: { passo: 0.35, notas: [43, 50, 55, 58, 46, 53, 60, 62] },
};

class AudioHistoria {
  constructor(audio, musica) {
    this.audio = audio;
    this.musica = musica;
    this.musica.pausar?.();
    this.sintese = window.speechSynthesis;
    const ctx = audio.ctx;
    if (!ctx || !audio.ligado) return;
    this.fx = new AudioFX();
    this.fx.ctx = ctx;
    this.fx.master = ctx.createGain();
    this.fx.master.connect(audio.master);
    this.trilha = new AudioFX();
    this.trilha.ctx = ctx;
    this.trilha.master = ctx.createGain();
    this.trilha.master.gain.value = CONFIG.audio.volumeMusica;
    if (musica.ligado !== false) this.trilha.master.connect(ctx.destination);
    this.proximaNota = 0;
    this.indiceNota = 0;
  }

  atualizar(cena, tempo, global) {
    if (!this.trilha) return;
    const modo = cena.trilha;
    if (modo !== this.modo) {
      this.modo = modo;
      this.proximaNota = global;
      this.indiceNota = 0;
    }
    const musica = TRILHAS_HISTORIA[modo];
    if (!musica || global < this.proximaNota) return;
    const i = this.indiceNota++;
    this.proximaNota = global + musica.passo * (modo === "falha" ? 1 - tempo * 0.065 : 1);
    const hz = 440 * 2 ** ((musica.notas[i % musica.notas.length] - 69) / 12);
    const forte = modo === "luta";
    const tensao = modo === "falha" ? 0.55 + tempo * 0.13 : 1;
    const nivel = modo === "final" ? Math.min(1, 0.52 + i * 0.027) : tensao;
    this.trilha._tom(hz, hz * (modo === "falha" ? 0.95 : 1), musica.passo * 1.9,
      forte ? "sawtooth" : "triangle", (forte ? 0.06 : 0.095) * nivel);
    if (i % 2 === 0) {
      this.trilha._tom(hz / 2, forte ? 35 : hz / 2, forte ? 0.16 : 0.6, "sine", 0.14 * nivel);
      if (forte || modo === "final") this.trilha._ruido(0.085, 0.075 * nivel, 1500);
    }
    if (modo === "final" && i % 4 === 0) {
      this.trilha._tom(hz * 2.998, hz * 2.998, 0.96, "triangle", 0.045 * nivel);
    }
  }

  tocar(nome) {
    const fx = this.fx;
    if (!fx) return;
    switch (nome) {
      case "controle":
        fx._ruido(0.035, 0.12, 3700);
        fx._tom(580, 350, 0.05, "triangle", 0.05);
        break;
      case "ambiente": fx._ruido(2.4, 0.12, 320); break;
      case "asas": fx._ruido(0.37, 0.28, 680); break;
      case "metal":
        fx._tom(2750, 1930, 0.13, "triangle", 0.19);
        fx._tom(3850, 2790, 0.14, "sine", 0.1, 0.04);
        break;
      case "portal":
        fx._tom(67, 540, 0.55, "sine", 0.25);
        fx._ruido(0.4, 0.15, 850);
        break;
      case "falha":
        for (let i = 0; i < 4; i++) fx._tom(100 + 190 * (i % 3), 42 + 85 * i,
          0.08, "square", 0.13, i * 0.085);
        fx._ruido(0.27, 0.15, 2000);
        break;
      case "colisao":
        fx._tom(93, 27, 0.86, "sine", 0.66);
        fx._ruido(0.72, 0.47, 870);
        fx._tom(410, 62, 0.28, "triangle", 0.25);
        break;
      case "objeto":
        fx._ruido(0.11, 0.13, 970);
        fx._tom(315, 169, 0.1, "triangle", 0.09);
        break;
      default: fx[nome]();
    }
  }

  falar(nome, texto, duracao) {
    if (!this.sintese || !this.audio.ligado || !CONFIG.audio.volumeMaster) return;
    const vozes = this.sintese.getVoices().filter((v) => v.lang.toLowerCase() === "pt-br");
    const voz = vozes.find((v) => v.localService) || vozes[0];
    if (!voz) return;
    const fala = new SpeechSynthesisUtterance(texto);
    fala.voice = voz;
    fala.lang = "pt-BR";
    fala.rate = Math.max(1, Math.min(1.43, texto.split(" ").length / (duracao * 3.3)));
    fala.pitch = nome === "Morgana" ? 0.86 : nome === "Vitor" ? 1.2 : 1;
    fala.volume = CONFIG.audio.volumeMaster;
    if (this.falou) this.sintese.cancel();
    this.sintese.speak(fala);
    this.falou = true;
  }

  encerrar() {
    this.fx?.master.disconnect();
    this.trilha?.master.disconnect();
    if (this.falou) this.sintese.cancel();
    this.musica.retomar?.();
  }
}
