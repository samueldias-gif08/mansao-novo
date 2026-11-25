"use strict";

/* ===========================================================================
   6) ÁUDIO — Web Audio API sintetizado (sem arquivos)
   Inicializa só após um gesto do usuário (regra dos navegadores).
   =========================================================================== */

class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ligado = true;
  }

  // Cria o AudioContext na primeira interação.
  garantir() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.ligado = false;
      return;
    }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.audio.volumeMaster;
    this.master.connect(this.ctx.destination);
  }

  // Envelope de tom (oscilador) com decaimento exponencial.
  _tom(freqIni, freqFim, dur, tipo, vol, atraso = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + atraso;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freqIni, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqFim), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Estouro de ruído (impactos secos).
  _ruido(dur, vol, corte, atraso = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + atraso;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filtro = this.ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = corte;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filtro).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // --- Sons do jogo (cada um isolado e fácil de ajustar) ---
  soco() {
    if (!this.ligado) return;
    this._tom(220, 90, 0.1, "square", 0.5);
    this._ruido(0.06, 0.25, 1200);
  }

  capoeira(efeito) {
    if (!this.ligado) return;
    const rajada = efeito === "projetil" || efeito === "final";
    const carga = efeito === "especial";
    this._ruido(rajada ? 0.23 : 0.12, 0.18, rajada ? 2600 : 1350);
    this._tom(carga ? 130 : 390, carga ? 430 : 120, carga ? 0.32 : 0.12, "sine", 0.14);
    if (rajada) this._tom(620, 260, 0.22, "triangle", 0.12, 0.035);
  }
  chute() {
    if (!this.ligado) return;
    this._tom(160, 60, 0.16, "sawtooth", 0.5);
    this._ruido(0.08, 0.3, 900);
  }
  projetil() {
    if (!this.ligado) return;
    this._tom(520, 180, 0.22, "sine", 0.4);
    this._tom(260, 90, 0.22, "triangle", 0.25);
  }
  ondaSonica() {
    if (!this.ligado) return;
    this._tom(165, 61, 0.24, "triangle", 0.42);
    this._tom(210, 83, 0.19, "sine", 0.24, 0.055);
    this._ruido(0.17, 0.17, 750);
  }
  graveGreeg() {
    if (!this.ligado) return;
    this._tom(105, 41, 0.34, "sine", 0.68);
    this._tom(132, 49, 0.22, "triangle", 0.27, 0.07);
    this._ruido(0.14, 0.19, 710);
  }
  rajadaMorgana() {
    if (!this.ligado) return;
    this._ruido(0.39, 0.34, 1700);
    this._tom(190, 73, 0.31, "triangle", 0.22);
  }
  navegacaoMetalMenu() {
    if (!this.ligado) return;
    this._tom(1320, 1190, 0.08, "sine", 0.16);
    this._tom(2180, 1920, 0.04, "triangle", 0.05, 0.009);
  }
  trovaoMorgana() {
    if (!this.ligado) return;
    this._ruido(0.3, 0.42, 1750);
    this._tom(120, 39, 0.29, "triangle", 0.3);
  }
  impactoTrindade(indice) {
    if (!this.ligado) return;
    this._tom(290 - indice * 53, 100 - indice * 16, 0.09 + indice * 0.025, "triangle", 0.23);
  }
  corteAr() {
    if (!this.ligado) return;
    this._ruido(0.13, 0.32, 3400);
    this._tom(710, 190, 0.12, "triangle", 0.13);
  }
  acerto() {
    if (!this.ligado) return;
    this._ruido(0.1, 0.5, 2600);
    this._tom(300, 120, 0.08, "square", 0.3);
  }
  bloqueio() {
    if (!this.ligado) return;
    this._ruido(0.06, 0.35, 4200);
    this._tom(700, 500, 0.05, "square", 0.15);
  }
  especial() {
    if (!this.ligado) return;
    this._tom(180, 700, 0.2, "sawtooth", 0.4);
    this._tom(90, 300, 0.35, "square", 0.3, 0.05);
  }
  ko() {
    if (!this.ligado) return;
    this._tom(300, 40, 0.6, "sawtooth", 0.5);
    this._ruido(0.5, 0.4, 800);
    this._tom(120, 30, 0.7, "square", 0.3, 0.05);
  }
  pulo() {
    if (!this.ligado) return;
    this._tom(300, 600, 0.1, "sine", 0.18);
  }
}

/* ===========================================================================
   6b) MÚSICA — HTMLAudioElement em loop por tela.
   Arquivos esperados em assets/: musica_menu.mp3, musica_luta.mp3, musica_vitoria.mp3
   Troque os arquivos a qualquer momento sem tocar no código.
   =========================================================================== */

class MusicaFX {
  constructor() {
    // Trilhas indexadas por nome lógico.
    this.trilhas = {};
    this.nomeAtual = null;
    this.ligado = true;
  }

  // Pré-carrega as trilhas e retorna uma Promise que resolve quando todas estão
  // prontas para tocar (evento canplay) ou após timeout de segurança de 8s.
  precarregar() {
    const arquivos = {
      menu: "assets/audio/musica_menu.mp3",
      luta: "assets/audio/musica_luta.mp3",
      vitoria: "assets/audio/musica_vitoria.mp3",
      vs: "assets/audio/musica_vs.mp3",
    };
    const promessas = [];
    for (const [nome, src] of Object.entries(arquivos)) {
      const audio = new Audio(src);
      audio.loop = true;
      audio.volume = CONFIG.audio.volumeMusica;
      audio.preload = "auto";
      this.trilhas[nome] = audio;
      promessas.push(
        new Promise((resolve) => {
          let resolvido = false;
          const ok = () => { if (!resolvido) { resolvido = true; resolve(); } };
          audio.addEventListener("canplay", ok, { once: true });
          audio.addEventListener("error", ok, { once: true });
          setTimeout(ok, 8000); // garante que não trava indefinidamente
        }),
      );
    }
    return Promise.all(promessas);
  }

  // Toca a trilha indicada; se já estiver tocando, não reinicia.
  // Só começa a tocar após o primeiro gesto do usuário (política de autoplay).
  tocar(nome) {
    if (!this.ligado) return;
    if (this.nomeAtual === nome) return;

    // Para a trilha anterior imediatamente.
    const anterior = this.trilhas[this.nomeAtual];
    if (anterior) {
      anterior.pause();
      anterior.currentTime = 0;
    }

    this.nomeAtual = nome;
    const prox = this.trilhas[nome];
    if (!prox) return;

    prox.volume = CONFIG.audio.volumeMusica;
    const tentativa = prox.play();
    if (tentativa !== undefined) {
      tentativa.catch(() => {
        // Navegador bloqueou autoplay (política de interação do usuário).
        // Registra um listener único: assim que qualquer tecla for pressionada,
        // tenta tocar novamente — isso garante que a música começa no 1º ENTER.
        const retry = () => {
          if (this.nomeAtual === nome) prox.play().catch(() => {});
        };
        document.addEventListener("keydown", retry, { once: true });
      });
    }
  }

  // Pausa temporária (ex.: durante hit stop — opcional).
  pausar() {
    const t = this.trilhas[this.nomeAtual];
    if (t) t.pause();
  }

  retomar() {
    if (!this.ligado) return;
    const t = this.trilhas[this.nomeAtual];
    if (t) t.play().catch(() => {});
  }
}

/* ===========================================================================
   6c) SOM DE UI — efeitos sonoros dos menus (navegação, confirmação, voltar).
   Arquivos esperados em assets/audio/:
     sfx_confirmar.mp3   → ENTER na tela de título
     sfx_navegar.mp3     → trocar opção no menu de modo
     sfx_personagem.mp3  → trocar personagem na seleção
     sfx_selecionar.mp3  → confirmar personagem escolhido
     sfx_voltar.mp3      → ESC / voltar para tela anterior
   =========================================================================== */

class SomUI {
  constructor() {
    this.sons = {};
  }

  // Pré-carrega os efeitos e retorna uma Promise que resolve quando todos estão
  // prontos (canplay/error) ou após timeout de 8s.
  precarregar() {
    const arquivos = {
      confirmar: "assets/audio/sfx_confirmar.mp3",
      navegar: "assets/audio/sfx_navegar.mp3",
      personagem: "assets/audio/sfx_personagem.mp3",
      selecionar: "assets/audio/sfx_selecionar.mp3",
      voltar: "assets/audio/sfx_voltar.mp3",
    };
    const promessas = [];
    for (const [nome, src] of Object.entries(arquivos)) {
      const audio = new Audio(src);
      audio.preload = "auto";
      this.sons[nome] = audio;
      promessas.push(
        new Promise((resolve) => {
          let resolvido = false;
          const ok = () => { if (!resolvido) { resolvido = true; resolve(); } };
          audio.addEventListener("canplay", ok, { once: true });
          audio.addEventListener("error", ok, { once: true });
          setTimeout(ok, 8000);
        }),
      );
    }
    return Promise.all(promessas);
  }

  // Toca o efeito indicado. Reinicia do início para poder disparar rapidamente.
  tocar(nome) {
    const s = this.sons[nome];
    if (!s) return;
    s.volume = CONFIG.audio.volumeUI;
    s.currentTime = 0;
    s.play().catch(() => {});
  }
}

