"use strict";

const OPCOES_MENU = [
  ["1 JOGADOR", "Enfrente a inteligência artificial"],
  ["2 JOGADORES", "Partida local entre dois jogadores"],
  ["CONFIGURAÇÕES", "Ajuste volume e outras opções"],
];

const OPCOES_DIFICULDADE = [
  ["FÁCIL", "IA reage mais devagar, ideal para começar"],
  ["MÉDIO", "Equilíbrio entre desafio e diversão"],
  ["DIFÍCIL", "IA agressiva e precisa — sem piedade"],
];

class MenuVisual {
  desenharCapaViva(ctx, agora) {
    ctx.save();
    for (let i = 0; i < 24; i++) {
      const t = agora * (0.014 + i % 4 * 0.004);
      const x = (i * 173 + t * 0.65 + Math.sin(t / 40 + i) * 8) % LARGURA;
      const y = ALTURA - (i * 73 + t) % ALTURA;
      const brasa = i % 3 !== 0;
      ctx.fillStyle = brasa ? "#ffae72" : "#f2ebe2";
      ctx.globalAlpha = (brasa ? 0.36 : 0.15) * (0.57 + 0.43 * Math.sin(agora / 291 + i));
      ctx.fillRect(x, y, brasa ? 2 + i % 3 : 1, brasa ? 1.3 : 1);
    }
    for (let i = 0; i < 2; i++) {
      const x = 150 + i * 595 + Math.sin(agora * 0.00021 + i) * 54;
      const y = 465 + Math.cos(agora * 0.0003 + i) * 16;
      const fumaca = ctx.createRadialGradient(x, y, 2, x, y, 88);
      fumaca.addColorStop(0, "#e6b59c10");
      fumaca.addColorStop(1, "#e6b59c00");
      ctx.globalAlpha = 1;
      ctx.fillStyle = fumaca;
      ctx.fillRect(x - 88, y - 88, 176, 176);
    }
    ctx.restore();
  }

  _gradienteLocal(ctx, x, y, w, h) {
    const sombra = ctx.createLinearGradient(x, y, x + w, y);
    sombra.addColorStop(0, "#09070bdc");
    sombra.addColorStop(0.69, "#09070ba0");
    sombra.addColorStop(1, "#09070b00");
    ctx.fillStyle = sombra;
    ctx.fillRect(x, y, w, h);
  }

  desenharInicio(jogo, ctx, agora) {
    const S = jogo.start;
    this.desenharCapaViva(ctx, agora);
    if (S.fase === "attract") {
      this._desenharApresentacao(jogo, ctx);
      return;
    }

    ctx.save();
    if (S.fase === "intro") {
      const fade = Math.max(0, 1 - S.t / 0.75);
      ctx.fillStyle = `rgba(6,4,8,${fade})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }
    const entrada = S.fase === "intro" ? Math.max(0, Math.min(1, (S.t - 0.58) / 0.44)) : 1;
    const saida = S.fase === "saindo" ? Math.max(0, 1 - S.t / START_TIMING.saida) : 1;
    ctx.globalAlpha = entrada * saida;
    ctx.translate(-16 * (1 - entrada), 0);
    this._gradienteLocal(ctx, 0, 381, 445, 87);
    ctx.restore();

    if (S.fase === "saindo") this.desenharCorte(ctx, S.t / START_TIMING.saida);
    this._rodape(ctx, CREDITOS);
  }

  _desenharApresentacao(jogo, ctx) {
    const S = jogo.start;
    const pers = PERSONAGENS[S.attractIdx % PERSONAGENS.length];
    const progresso = S.t / START_TIMING.attractPorSlide;
    const alpha = Math.max(0, Math.min(1, Math.min(progresso, 1 - progresso) * 7));
    ctx.save();
    ctx.globalAlpha = alpha;
    this._gradienteLocal(ctx, 0, 233, 365, 244);
    const foto = jogo.recursos.artesSelecao?.[pers]?.retrato || jogo.recursos.retrato(pers) ||
      jogo.recursos.frame(pers, "idle", 0)?.img;
    if (foto) jogo._desenharThumb(ctx, foto, 31, 251, 128, 128, 0.24);
    ctx.strokeStyle = "#b89782";
    ctx.strokeRect(31, 251, 128, 128);
    this.desenharTextoOpcao(ctx, jogo.recursos.nome(pers).toUpperCase(), 30, 414, false, alpha, 25);
    ctx.textAlign = "left";
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#f3ddd2";
    const ficha = jogo.recursos.ficha(pers);
    ctx.fillText(`${ficha.cidade} · ${ficha.estilo}`, 31, 436, 315);
    ctx.restore();
    this._rodape(ctx, "PRESSIONE QUALQUER TECLA");
  }

  desenharModos(jogo, ctx, agora) {
    this._desenharOpcoes(ctx, agora, jogo.modoRevealT0, "MODO DE JOGO",
      OPCOES_MENU, jogo.menuIndex, "ao título");
  }

  desenharDificuldade(jogo, ctx, agora) {
    this._desenharOpcoes(ctx, agora, jogo.dificuldadeRevealT0 ?? 0, "DIFICULDADE",
      OPCOES_DIFICULDADE, jogo.dificuldadeIndex, "ao menu");
  }

  _desenharOpcoes(ctx, agora, inicio, titulo, opcoes, selecionado, destinoVoltar) {
    this.desenharCapaViva(ctx, agora);
    if (inicio !== this.entradaOpcoes || titulo !== this.tituloOpcoes) {
      this.entradaOpcoes = inicio;
      this.tituloOpcoes = titulo;
      this.destaques = opcoes.map(() => 0);
      this.ultimoQuadro = agora;
    }
    const dt = Math.min(0.06, Math.max(0, (agora - this.ultimoQuadro) / 1000));
    this.ultimoQuadro = agora;
    const chegada = Math.max(0, (agora - inicio) / 1000);
    ctx.save();
    ctx.globalAlpha = Math.min(1, chegada * 5);
    this._gradienteLocal(ctx, 0, 211, 422, 225);
    ctx.textAlign = "left";
    ctx.font = "bold 13px 'Bodoni MT', 'Palatino Linotype', serif";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#09070b";
    ctx.fillStyle = "#d6bab1";
    ctx.strokeText(titulo, 35, 229);
    ctx.fillText(titulo, 35, 229);
    ctx.restore();
    for (const [i, [nome, descricao]] of opcoes.entries()) {
      const aparecer = Math.max(0, Math.min(1, (chegada - i * 0.055) / 0.24));
      const ativo = i === selecionado;
      const alvo = Number(ativo);
      const destaque = this.destaques[i] += (alvo - this.destaques[i]) * Math.min(1, dt * 15);
      if (!aparecer) continue;
      const x = 33 - (1 - aparecer) ** 2 * 23;
      const y = 272 + i * 63;
      if (destaque > 0.01) this._pincelada(ctx, x, y, aparecer * destaque, agora);
      this.desenharTextoOpcao(ctx, nome, x, y, ativo, aparecer, 31 + 4 * destaque, destaque);
      ctx.save();
      ctx.globalAlpha = aparecer * (0.7 + destaque * 0.3);
      ctx.font = "13px 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#09070b";
      ctx.fillStyle = "#e8d6d3";
      ctx.strokeText(descricao, x + 2, y + 18);
      ctx.fillText(descricao, x + 2, y + 18);
      ctx.restore();
    }
    this._rodape(ctx, `W/S ou ↑/↓ escolhe   ·   ENTER confirma   ·   ESC volta ${destinoVoltar}`);
  }

  desenharTextoOpcao(ctx, texto, x, y, ativo, alpha, tamanho, vermelho = Number(ativo),
    alinhamento = "left", largura = 340) {
    if (alpha <= 0) return;
    const metal = ctx.createLinearGradient(x, y - tamanho, x, y + 3);
    const liga = [
      [0, [255, 255, 255], [255, 179, 164]],
      [0.43, [240, 223, 219], [255, 90, 101]],
      [0.57, [156, 155, 169], [255, 74, 87]],
      [0.73, [233, 230, 236], [219, 54, 70]],
      [1, [163, 167, 175], [173, 18, 42]],
    ];
    for (const [ponto, prata, carmesim] of liga) {
      const tom = prata.map((canal, i) => Math.round(canal + (carmesim[i] - canal) * vermelho));
      metal.addColorStop(ponto, `rgb(${tom.join(",")})`);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = alinhamento;
    ctx.font = ativo
      ? `italic 900 ${tamanho}px 'Impact', 'Bahnschrift Condensed', sans-serif`
      : `bold ${tamanho}px 'Bodoni MT', 'Baskerville Old Face', 'Palatino Linotype', serif`;
    ctx.lineJoin = "round";
    ctx.lineWidth = ativo ? 4 : 3;
    ctx.strokeStyle = "#10070d";
    ctx.strokeText(texto, x, y, largura);
    ctx.fillStyle = metal;
    ctx.fillText(texto, x, y, largura);
    ctx.restore();
  }

  _pincelada(ctx, x, y, alpha, agora) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = 310 * alpha;
    const risco = ctx.createLinearGradient(x - 8, y, x + w, y);
    risco.addColorStop(0, "#f83a59");
    risco.addColorStop(0.7, "#a91e39a3");
    risco.addColorStop(1, "#a91e3900");
    ctx.fillStyle = risco;
    ctx.beginPath();
    ctx.moveTo(x - 9, y + 5);
    ctx.lineTo(x + 17, y - 4);
    ctx.lineTo(x + w, y - 7);
    ctx.lineTo(x + w * 0.82, y + 1);
    ctx.lineTo(x + 11, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffc08d";
    for (let i = 0; i < 6; i++) {
      const t = (agora * 0.1 + i * 49) % 272;
      ctx.globalAlpha = alpha * (1 - t / 272) * 0.65;
      ctx.fillRect(x + 9 + t, y - 6 - (i % 3) * 4 - t * 0.045, 2 + i % 2, 1);
    }
    ctx.restore();
  }

  desenharCorte(ctx, progresso) {
    ctx.save();
    const t = Math.max(0, Math.min(1, progresso));
    const brilho = Math.sin(t * Math.PI) ** 2;
    ctx.translate(LARGURA * t, ALTURA * 0.54);
    ctx.rotate(-0.16);
    const linha = ctx.createLinearGradient(-320, 0, 85, 0);
    linha.addColorStop(0, "#d71e4100");
    linha.addColorStop(0.85, "#dd1c3e");
    linha.addColorStop(1, "#fff0db00");
    ctx.globalAlpha *= brilho * 0.78;
    ctx.fillStyle = linha;
    ctx.fillRect(-320, -2, 405, 4);
    ctx.restore();
  }

  _rodape(ctx, texto) {
    ctx.save();
    this._gradienteLocal(ctx, 0, ALTURA - 29, 535, 29);
    ctx.fillStyle = "#f3dcd4";
    ctx.textAlign = "left";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillText(texto, 17, ALTURA - 12);
    ctx.textAlign = "right";
    ctx.fillText(VERSAO, LARGURA - 17, ALTURA - 12);
    ctx.restore();
  }
}
