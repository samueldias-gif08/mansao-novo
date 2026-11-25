"use strict";

const limitarHistoria = (v) => Math.max(0, Math.min(1, v));
const misturarHistoria = (a, b, p) => a + (b - a) * p;
const suaveHistoria = (a, b, t) => {
  const p = limitarHistoria((t - a) / (b - a));
  return p * p * (3 - 2 * p);
};
const pulsoHistoria = (t, inicio, fim) =>
  t < inicio || t > fim ? 0 : Math.sin(Math.PI * (t - inicio) / (fim - inicio));
const MONITOR_HISTORIA = { x: 365, y: 126, w: 226, h: 73 };

function quadroHistoria(quadros, tempo) {
  let i = 0;
  while (i + 1 < quadros.length && quadros[i + 1][0] <= tempo) i++;
  const atual = quadros[i];
  const prox = quadros[i + 1] || atual;
  return [atual, prox, atual === prox ? 0 : suaveHistoria(atual[0], prox[0], tempo), i];
}

// Mantém a velocidade entre posições vizinhas e desacelera quando a trajetória muda de direção.
function trajetoriaHistoria(quadros, i, eixo, tempo) {
  const a = quadros[i], b = quadros[i + 1];
  if (!b) return a[eixo];
  const duracao = b[0] - a[0];
  const p = limitarHistoria((tempo - a[0]) / duracao);
  const delta = b[eixo] - a[eixo];
  const velocidade = delta / duracao;
  const tangente = (v) => v * velocidade > 0 ? 2 * v * velocidade / (v + velocidade) * duracao : 0;
  const anterior = quadros[i - 1], posterior = quadros[i + 2];
  const ida = anterior ? tangente((a[eixo] - anterior[eixo]) / (a[0] - anterior[0])) : 0;
  const volta = posterior ? tangente((posterior[eixo] - b[eixo]) / (posterior[0] - b[0])) : 0;
  return misturarHistoria(a[eixo], b[eixo], p * p * (3 - 2 * p)) +
    p * (1 - p) * ((1 - p) * ida - p * volta);
}

class Historia {
  constructor(jogo, destino) {
    this.recursos = jogo.recursos;
    this.catalogo = jogo.catalogo;
    this.destino = destino;
    this.audio = new AudioHistoria(jogo.audio, jogo.musica);
    this.indice = 0;
    this.tempo = 0;
    this.global = 0;
    this.ultimoSom = -1;
    this.ultimaFala = null;
    this.telaVirtual = document.createElement("canvas");
    this.telaVirtual.width = 320;
    this.telaVirtual.height = 180;
    this.ctxVirtual = this.telaVirtual.getContext("2d");
    this.transicao = document.createElement("canvas");
    this.transicao.width = this.transicao.height = 384;
    this.ctxTransicao = this.transicao.getContext("2d");
    this.efeitos = this._carregarQuadrosEfeitos();
    this.logo = this._criarLogo();
    this.audio.tocar("ambiente");
  }

  get cena() { return CENAS_HISTORIA[this.indice]; }

  atualizar(dt) {
    this.global += dt;
    this.tempo += dt;
    while (this.cena && this.tempo >= this.cena.duracao) {
      this.tempo -= this.cena.duracao;
      this.indice++;
      this.ultimoSom = -1;
      this.ultimaFala = null;
    }
    if (!this.cena) return false;
    const cena = this.cena;
    for (let i = this.ultimoSom + 1; i < cena.sons.length && cena.sons[i][0] <= this.tempo; i++) {
      if (this.tempo - cena.sons[i][0] < 0.26) this.audio.tocar(cena.sons[i][1]);
      this.ultimoSom = i;
    }
    const fala = this._fala(cena, this.tempo);
    if (fala && this.ultimaFala !== fala) {
      this.ultimaFala = fala;
      this.audio.falar(fala[2], fala[3], fala[1] - fala[0]);
    }
    this.audio.atualizar(cena, this.tempo, this.global);
    return true;
  }

  encerrar() {
    this.audio.encerrar();
    this.telaVirtual.width = 0;
    this.telaVirtual.height = 0;
    this.telaVirtual = this.ctxVirtual = null;
    this.transicao.width = this.transicao.height = 0;
    this.transicao = this.ctxTransicao = null;
    for (const quadro of this.efeitos) quadro.width = quadro.height = 0;
    this.efeitos.length = 0;
    if (this.logo) this.logo.width = 0;
    this.logo = null;
  }

  _fala(cena, t) {
    return cena.falas?.find(([inicio, fim]) => t >= inicio && t < fim);
  }

  desenhar(ctx) {
    const cena = this.cena;
    if (!cena) return;
    const t = this.tempo;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    this._cor(ctx, "#070711");
    switch (cena.id) {
      case "noite": this._noite(ctx, t); break;
      case "duelo": case "patrulha": case "tres": this._combate(ctx, cena, t); break;
      case "falha": this._falha(ctx, t); break;
      case "explosao": this._quarto(ctx, t, "explosao"); break;
      case "invasao": this._quarto(ctx, t, "invasao"); break;
      case "titulo": this._titulo(ctx, t); break;
    }
    this._moldura(ctx);
    const novoPlano = cena.id === "noite" || cena.id === "invasao";
    if (novoPlano) this._cor(ctx, "#090613", 1 - suaveHistoria(0, 0.45, t));
    this._legenda(ctx, this._fala(cena, t));
    ctx.restore();
  }

  _cor(ctx, cor, alpha = 1, x = 0, y = 0, w = LARGURA, h = ALTURA) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = cor;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  _cenario(ctx, id, reserva = null) {
    const img = this.recursos.artesHistoria?.[id] || reserva;
    if (!img?.naturalWidth) {
      const fallback = ctx.createLinearGradient(0, 0, 0, ALTURA);
      fallback.addColorStop(0, "#0b142d");
      fallback.addColorStop(0.63, "#21172e");
      fallback.addColorStop(1, "#110c19");
      this._cor(ctx, fallback);
      return;
    }
    const escala = Math.max(LARGURA / img.naturalWidth, ALTURA / img.naturalHeight);
    const w = img.naturalWidth * escala, h = img.naturalHeight * escala;
    ctx.drawImage(img, (LARGURA - w) / 2, (ALTURA - h) / 2, w, h);
  }

  _camera(ctx, x, y, zoom, inclinacao = 0, tremor = 0) {
    const margemX = LARGURA / (2 * zoom);
    const margemY = ALTURA / (2 * zoom);
    x = Math.min(LARGURA - margemX, Math.max(margemX, x));
    y = Math.min(ALTURA - margemY, Math.max(margemY, y));
    ctx.translate(LARGURA / 2 + Math.sin(this.global * 81) * tremor,
      ALTURA / 2 + Math.cos(this.global * 67) * tremor * 0.68);
    ctx.rotate(inclinacao);
    ctx.scale(zoom, zoom);
    ctx.translate(-x, -y);
  }

  _animacao(ctx, id, anim, t, x, y, direcao = 1, escala = 1, inclinacao = 0, chao = y,
    entradaSeguinte = null, misturaEntrada = 0) {
    const meta = this.recursos.meta(id, anim);
    const dados = meta?.framesReais ? meta : this.recursos.meta(id, "idle");
    const n = dados?.framesReais || 0;
    if (!n) return;
    const tempoQuadro = Math.max(0, t * dados.fps);
    const quadro = Math.floor(tempoQuadro);
    const i = dados.loop ? quadro % n : Math.min(n - 1, quadro);
    const seguinte = dados.loop ? (i + 1) % n : Math.min(n - 1, i + 1);
    const nome = dados === meta ? anim : "idle";
    const img = this.recursos.frame(id, nome, i)?.img;
    const proximo = entradaSeguinte || this.recursos.frame(id, nome, seguinte)?.img;
    if (!img?.naturalWidth) return;
    const w = this.recursos.frameW * escala;
    const h = this.recursos.frameH * escala;
    this._sombra(ctx, x, chao, w * 0.24, Math.max(0.13, 0.65 - (chao - y) / 310));
    const mistura = entradaSeguinte ? misturaEntrada : suaveHistoria(0.45, 1, tempoQuadro - quadro);
    this._sprite(ctx, this._transicaoSprite(img, proximo, mistura), x, y, w, h, direcao, inclinacao);
  }

  _transicaoSprite(atual, proximo, mistura) {
    if (!proximo?.width || atual === proximo || mistura <= 0) return atual;
    if (mistura >= 1) return proximo;
    const ctx = this.ctxTransicao;
    const tamanho = this.transicao.width;
    ctx.clearRect(0, 0, tamanho, tamanho);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1 - mistura;
    ctx.drawImage(atual, 0, 0, tamanho, tamanho);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = mistura;
    ctx.drawImage(proximo, 0, 0, tamanho, tamanho);
    return this.transicao;
  }

  _carregarQuadrosEfeitos() {
    const folha = this.recursos.artesHistoria?.efeitos;
    if (!folha?.naturalWidth) return [];
    const w = folha.naturalWidth / 4;
    const h = folha.naturalHeight / 4;
    return Array.from({ length: 16 }, (_, i) => {
      const sprite = document.createElement("canvas");
      sprite.width = Math.round(w);
      sprite.height = Math.round(h);
      sprite.getContext("2d").drawImage(folha, (i % 4) * w, Math.floor(i / 4) * h, w, h,
        0, 0, sprite.width, sprite.height);
      return sprite;
    });
  }

  _efeitoIlustrado(ctx, linha, fase, x, y, tamanho, opacidade) {
    if (!this.efeitos.length || opacidade <= 0 || tamanho <= 0) return false;
    const tempoQuadro = limitarHistoria(fase) * 3;
    const quadro = Math.floor(tempoQuadro);
    const inicio = linha * 4;
    const imagem = this._transicaoSprite(this.efeitos[inicio + quadro], this.efeitos[inicio + Math.min(quadro + 1, 3)],
      suaveHistoria(0, 1, tempoQuadro - quadro));
    ctx.save();
    ctx.globalAlpha *= limitarHistoria(opacidade);
    ctx.drawImage(imagem, x - tamanho / 2, y - tamanho / 2, tamanho, tamanho);
    ctx.restore();
    return true;
  }

  _sprite(ctx, img, x, y, w, h, direcao, inclinacao = 0) {
    ctx.save();
    ctx.translate(x, y - h * 0.36);
    ctx.rotate(inclinacao);
    ctx.scale(direcao, 1);
    ctx.drawImage(img, -w / 2, -h * 0.64, w, h);
    ctx.restore();
  }

  _sombra(ctx, x, y, r, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.2);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, "transparent");
    this._cor(ctx, g, 1, -r, -r, r * 2, r * 2);
    ctx.restore();
  }

  _ator(ctx, id, quadros, t, patrulha) {
    if (t < quadros[0][0]) return;
    const [a, b, p, i] = quadroHistoria(quadros, t);
    const [, x, y, anim] = a;
    const direcao = a[4] ?? quadros[0][4];
    const escala = a[5] ?? quadros[0][5] ?? 1;
    const teleporte = id === "belyx" && anim === "teleport" && a[0] === 5.32;
    const xx = patrulha ? trajetoriaHistoria(quadros, i, 1, t) : teleporte ? x : misturarHistoria(x, b[1], p);
    const yy = (patrulha ? trajetoriaHistoria(quadros, i, 2, t) : misturarHistoria(y, b[2], p)) +
      (id === "carter" ? Math.sin(t * 5.7) * 5 : 0);
    const virada = (b[4] ?? quadros[0][4]) !== direcao;
    const misturaEntrada = !teleporte && !virada && b[3] !== anim ? suaveHistoria(b[0] - 0.105, b[0], t) : 0;
    const entradaSeguinte = misturaEntrada > 0 ? this.recursos.frame(id, b[3], 0)?.img : null;
    ctx.save();
    if (teleporte) ctx.globalAlpha *= 1 - suaveHistoria(a[0], b[0], t);
    else if (id === "belyx" && anim === "teleport") ctx.globalAlpha *= suaveHistoria(a[0], a[0] + 0.24, t);
    let inicio = i;
    const vooCarter = id === "carter" && (anim === "idle" || anim.startsWith("patrulha_"));
    if (vooCarter || this.recursos.meta(id, anim)?.loop) {
      while (inicio > 0 && quadros[inicio - 1][3] === anim) inicio--;
    }
    const ritmo = vooCarter ? 0.55 : 1;
    this._animacao(ctx, id, anim, (t - quadros[inicio][0]) * ritmo, xx, yy, direcao, escala,
      misturarHistoria(a[6] || 0, b[6] || 0, p), Math.max(yy, 467), entradaSeguinte, misturaEntrada);
    ctx.restore();
  }

  _combate(ctx, cena, t, reacao = false) {
    const [a, b, p] = quadroHistoria(cena.cameras, t);
    const tremor = cena.id === "duelo" ? pulsoHistoria(t, 9.42, 9.92) * 9 :
      cena.id === "tres" ? pulsoHistoria(t, 9.65, 11) * 7 : pulsoHistoria(t, 7.62, 8.15) * 4;
    ctx.save();
    this._camera(ctx, misturarHistoria(a[1], b[1], p), misturarHistoria(a[2], b[2], p),
      misturarHistoria(a[3], b[3], p), misturarHistoria(a[4], b[4], p), reacao ? 0 : tremor);
    const mapa = this.catalogo.mapas[cena.id === "duelo" ? 2 : cena.id === "patrulha" ? 0 : 1]?.full ||
      this.recursos.mapa;
    this._cenario(ctx, cena.id === "patrulha" ? "rua" : cena.id === "tres" ? "mansao" : "arena", mapa);
    if (cena.id === "patrulha") {
      this._brilho(ctx, 76, 362, 250, "255,37,64", 0.25 + 0.19 * Math.sin(t * 4));
      this._brilho(ctx, 870, 349, 260, "41,98,255", 0.3 - 0.19 * Math.sin(t * 4));
      this._fumaca(ctx, 471, 445, t, 0.32, 450);
      if (t > 0.6 && t < 2.03) this._sombra(ctx, 970 - (t - 0.6) * 480, 447, 146, 0.75);
    }
    this._particulas(ctx, 480, 285, t, 32, cena.id === "duelo" ? "#ffc893" : "#ad9eff", 0.32, 430);
    for (const [id, quadros] of Object.entries(cena.atores)) {
      if (!reacao) this._ator(ctx, id, quadros, t, cena.id === "patrulha");
      else {
        const [, x, y, anim, dir, escala] = quadros.at(-1);
        const pose = id === "greeg" ? anim : id === "carter" ? "patrulha_curva" : "idle";
        this._animacao(ctx, id, pose, this.tempo * (id === "carter" ? 0.55 : 1),
          x, y - (id === "carter" ? Math.sin(this.tempo * 5.7) * 5 : 0),
          dir ?? quadros[0][4], escala || quadros[0][5] || 1, id === "carter" ? -0.12 : 0, 469);
      }
    }
    if (cena.id === "duelo" && !reacao) this._efeitosDuelo(ctx, t);
    if (cena.id === "patrulha") this._efeitosPatrulha(ctx, t);
    if (cena.id === "tres") this._efeitosTres(ctx, t);
    ctx.restore();
    if (cena.id === "duelo" && !reacao) this._cor(ctx, "#ffe5cd", 0.85 * suaveHistoria(9.44, 10, t));
    if (cena.id === "patrulha" && !reacao) {
      this._cor(ctx, "#ffe0a1", 0.68 * suaveHistoria(11.52, 12, t));
      this._cor(ctx, "#ffe5d6", 0.79 * (1 - suaveHistoria(0, 0.52, t)));
    }
    if (cena.id === "tres" && !reacao) {
      this._cor(ctx, "#ffe4ae", 0.67 * (1 - suaveHistoria(0, 0.5, t)));
      this._glitch(ctx, t, suaveHistoria(10.27, 11, t) * 0.73);
    }
  }

  _brilho(ctx, x, y, r, rgb, alpha) {
    if (alpha <= 0 || r <= 0) return;
    const luz = ctx.createRadialGradient(x, y, 0, x, y, r);
    luz.addColorStop(0, `rgba(${rgb},${Math.min(1, alpha)})`);
    luz.addColorStop(0.35, `rgba(${rgb},${Math.min(1, alpha * 0.54)})`);
    luz.addColorStop(1, `rgba(${rgb},0)`);
    this._cor(ctx, luz, 1, x - r, y - r, r * 2, r * 2);
  }

  _particulas(ctx, x, y, t, n, cor, alpha, raio, expansao = false) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.fillStyle = cor;
    const opacidade = alpha * ctx.globalAlpha;
    for (let i = 0; i < n; i++) {
      const vida = (t * (expansao ? (0.7 + i % 5 * 0.1) : 0.17) + i * 0.1317) % 1;
      const ang = i * 2.39996 + (expansao ? t * 0.27 : 0);
      const r = raio * vida * (0.4 + (i % 11) / 17);
      const px = x + Math.cos(ang) * r;
      const py = y + Math.sin(ang) * r * 0.62 - vida * (expansao ? 16 : 47);
      ctx.globalAlpha = opacidade * (1 - vida);
      ctx.fillRect(px, py, 1 + i % 4, 1 + i % 2);
    }
    ctx.restore();
  }

  _fumaca(ctx, x, y, t, alpha, raio = 320) {
    if (alpha > 0 && this.efeitos.length) {
      for (let i = 0; i < 3; i++) {
        const fase = (t * (0.13 + i * 0.012) + i * 0.24) % 1;
        const opacidade = pulsoHistoria(fase, 0, 1) * alpha;
        this._efeitoIlustrado(ctx, 3, fase, x + (i - 1) * raio * 0.48 + Math.sin(t * 0.6 + i) * 33,
          y - 40 - fase * 137, raio * (1.06 + fase * 0.67), opacidade);
      }
      return;
    }
    for (let i = 0; i < 9; i++) {
      const fase = ((t * (0.098 + i * 0.003) + i * 0.173) % 1);
      const px = x + (i - 4) * raio * 0.28 + Math.sin(i * 3 + t * 0.75) * 38;
      this._brilho(ctx, px, y - fase * 158, raio * (0.28 + fase * 0.25), "111,106,146", alpha * (1 - fase));
    }
  }

  _onda(ctx, x, y, r, cor, alpha, aspecto = 0.63) {
    if (alpha <= 0 || r < 1) return;
    if (this.efeitos.length) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, aspecto);
      ctx.filter = cor === "#c9f98c" ? "hue-rotate(54deg)" :
        cor === "#ffc77d" ? "none" : "saturate(0.38)";
      this._efeitoIlustrado(ctx, 2, 0.68, 0, 0, r * 2.15, alpha * 0.81);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = cor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * aspecto, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _raio(ctx, x, y, destinoX, destinoY, t, cor, alpha = 1, largura = 3) {
    if (alpha <= 0) return;
    const dx = destinoX - x;
    const dy = destinoY - y;
    const comprimento = Math.hypot(dx, dy);
    if (this.efeitos.length && largura >= 2 && comprimento >= 24) {
      ctx.save();
      ctx.translate(x + dx / 2, y + dy / 2);
      ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2 + 0.29);
      ctx.scale(Math.max(0.10, Math.min(0.37, (34 + largura * 5) / comprimento)), 1.2);
      ctx.filter = cor === "#ff4b79" || cor === "#ff5076" ? "hue-rotate(73deg)" :
        cor === "#82d8ff" ? "hue-rotate(-35deg)" : "none";
      this._efeitoIlustrado(ctx, 1, 0.025 + 0.018 * Math.sin(t * 18), 0, 0, comprimento * 1.42, alpha);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = cor;
    ctx.lineWidth = largura;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 1; i < 10; i++) {
      const p = i / 10;
      ctx.lineTo(misturarHistoria(x, destinoX, p) + Math.sin(i * 12.39 + t * 34) * 24 * Math.sin(Math.PI * p),
        misturarHistoria(y, destinoY, p) + Math.cos(i * 7.13 + t * 28) * 13);
    }
    ctx.lineTo(destinoX, destinoY);
    ctx.stroke();
    ctx.restore();
  }

  _impacto(ctx, x, y, t, duracao, raio = 260) {
    if (t < 0 || t >= duracao) return;
    const p = t / duracao;
    if (this._efeitoIlustrado(ctx, 2, p, x, y, raio * (1.4 + p * 0.45), 1 - suaveHistoria(0.67, 1, p))) {
      this._brilho(ctx, x, y, raio * (0.28 + p * 0.65), "255,196,127", 0.26 * (1 - p));
      return;
    }
    this._brilho(ctx, x, y, 15 + raio * p, "255,202,144", 0.56 * (1 - p));
    this._onda(ctx, x, y, p * raio, "#ffe4bf", 0.9 * (1 - p));
    this._particulas(ctx, x, y, t, 35, "#ffe1ab", 1 - p, 30 + p * raio, true);
  }

  _efeitosDuelo(ctx, t) {
    for (const [segundo, x, y] of [[2.46, 398, 343], [2.93, 399, 363], [4.22, 440, 335], [5.72, 428, 350]]) {
      this._impacto(ctx, x, y, t - segundo, 0.34, 73);
    }
    this._impacto(ctx, 480, 326, t - 9.44, 0.65, 405);
  }

  _efeitosPatrulha(ctx, t) {
    const boomerang = pulsoHistoria(t, 2.98, 4.75);
    if (boomerang > 0) {
      const p = (t - 2.98) / 1.77;
      const x = 444 + p * 350, y = 287 + 104 * Math.sin(p * Math.PI);
      this._brilho(ctx, x, y, 38, "255,179,89", boomerang * 0.5);
      this._onda(ctx, x, y, 32, "#ffc77d", boomerang, 0.38);
      this._impacto(ctx, 625, 379, t - 3.88, 0.48, 96);
    }
    for (let i = 0; i < 4; i++) {
      const p = (t - 5.58 - i * 0.13) / 1.26;
      if (p > 0 && p < 1) this._onda(ctx, 640 - 524 * p, 351 - 80 * p, 20 + p * 67,
        "#c9f98c", 0.7 * (1 - p), 1.48);
    }
    this._impacto(ctx, 610, 359, t - 7.67, 0.48, 155);
    if (t >= 9.1) {
      this._algemas(ctx, 682, 387 + Math.sin(t * 19) * 2);
      this._brilho(ctx, 586, 287, 75, "255,211,105", suaveHistoria(11, 12, t) * 0.8);
    }
  }

  _algemas(ctx, x, y, escala = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(escala, escala);
    ctx.strokeStyle = "#deedf8";
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(i * 5, Math.sin(i) * 2, 5, 3, -0.15, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _efeitosTres(ctx, t) {
    const trevas = pulsoHistoria(t, 0.88, 2.0) + pulsoHistoria(t, 5.1, 6.03) + pulsoHistoria(t, 7.1, 9.3);
    this._brilho(ctx, t < 3 ? 181 : t < 6 ? (t < 5.76 ? 551 : 369) : 192, 359, 132,
      "156,41,241", trevas * 0.65);
    for (const [segundo, x, y] of [[3.27, 660, 340], [3.92, 669, 336], [4.5, 659, 376], [4.91, 644, 329]]) {
      this._impacto(ctx, x, y, t - segundo, 0.29, 89);
    }
    for (let i = 0; i < 5; i++) {
      const p = (t - 7.18 - i * 0.14) / 1.65;
      if (p > 0 && p < 1) this._onda(ctx, 440 - p * 340, 344 + i * 10, 30 + p * 92, "#dfd9ff", (1 - p) * 0.64, 0.24);
    }
    const raio = pulsoHistoria(t, 8.62, 10.4);
    this._raio(ctx, 384, 10, 482, 272, t, "#ff4b79", raio, 5);
    const sombrio = pulsoHistoria(t, 8.95, 10.4);
    this._raio(ctx, 234, 362, 482, 272, t, "#ad57fe", sombrio, 7);
    this._esfera(ctx, 482, 272, t, suaveHistoria(9.25, 10.92, t));
  }

  _esfera(ctx, x, y, t, forca) {
    if (forca <= 0) return;
    const r = Math.min(195, (25 + 120 * forca) * (0.96 + 0.07 * Math.sin(t * 18)));
    const fase = 0.21 + Math.min(1, forca) * 0.46 + 0.055 * Math.sin(t * 9);
    if (this._efeitoIlustrado(ctx, 1, fase, x, y, r * 3.05, Math.min(1, forca * 1.56))) {
      this._brilho(ctx, x, y, r * 1.32, "125,88,255", Math.min(0.25, forca * 0.3));
      this._particulas(ctx, x, y, t, 31, "#ded6ff", Math.min(0.7, forca), r * 1.85, true);
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    this._brilho(ctx, x, y, r * 1.5, "153,52,255", Math.min(0.78, forca));
    this._brilho(ctx, x, y, r, "104,165,255", Math.min(0.92, forca * 1.1));
    this._brilho(ctx, x, y, r * 0.55, "232,248,255", Math.min(0.97, forca * 1.57));
    for (let i = 0; i < 4; i++) {
      const ang = t * (0.7 + i * 0.16) + i * 2.3;
      this._raio(ctx, x, y, x + r * Math.cos(ang), y + r * Math.sin(ang), t + i, i % 2 ? "#ff5076" : "#bbb6ff",
        Math.min(0.85, forca));
      this._onda(ctx, x, y, r * (0.64 + i * 0.19), i % 2 ? "#885eff" : "#8fddff", Math.min(0.28, forca), 0.61);
    }
    this._particulas(ctx, x, y, t, 45, "#dad6ff", Math.min(1, forca), r * 2, true);
    ctx.restore();
  }

  _glitch(ctx, t, forca, x = 0, y = 0, w = LARGURA, h = ALTURA) {
    if (forca <= 0) return;
    const tic = Math.floor(t * 13);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let i = 0; i < 15; i++) {
      const a = ((i * 7.17 + tic * 0.35) % 1);
      const b = ((i * 4.71 + tic * 0.293) % 1);
      const px = x + a * w;
      const py = y + b * h;
      const ww = w * (0.025 + (i % 7) * 0.027) * forca;
      this._cor(ctx, i % 4 === 0 ? "#080917" : i % 2 ? "#a74cf3" : "#72c6fa",
        forca * (i % 4 === 0 ? 0.83 : 0.33), px, py, ww, 1 + (i % 5) * forca * 5);
      if (i % 3 === 0) this._cor(ctx, "#fcb5ec", forca * 0.26, px + 6, py + 4, ww, 1);
    }
    ctx.restore();
  }

  _noite(ctx, t) {
    if (t < 2.3) {
      ctx.save();
      this._camera(ctx, 477, 230, 1 + suaveHistoria(0, 2.23, t) * 1.7);
      this._cenario(ctx, "janela");
      this._particulas(ctx, 478, 266, t, 37, "#b4ccff", 0.44, 555);
      ctx.restore();
    }
    const entrar = suaveHistoria(1.52, 2.3, t);
    if (entrar > 0) {
      ctx.save();
      ctx.globalAlpha *= entrar;
      this._quarto(ctx, t, "noite");
      ctx.restore();
    }
    const atravessar = suaveHistoria(7.26, 8, t);
    if (atravessar > 0) {
      ctx.save();
      ctx.globalAlpha *= atravessar;
      this._combate(ctx, CENAS_HISTORIA[1], 0);
      ctx.restore();
      this._brilho(ctx, 480, 270, 570, "152,163,255", pulsoHistoria(t, 7.22, 8) * 0.37);
    }
  }

  _falha(ctx, t) {
    const s = t < 1.7 ? 0 : t < 3.43 ? 1 : 2;
    const plano = CENAS_HISTORIA[s + 1];
    const tempos = [7.83, 10.88, 10.18];
    this._combate(ctx, plano, tempos[s] + (s === 2 ? suaveHistoria(3.43, 6.1, t) * 0.66 : 0), true);
    const forca = 0.22 + t * 0.1;
    for (let i = 0; i < 5; i++) {
      const ang = i * 1.45 - 0.68;
      const x = 483 + Math.cos(ang) * 448, y = 199 + Math.sin(ang) * 281;
      this._raio(ctx, 483, 197, x, y, t * 0.38 + i, i % 2 ? "#c797fc" : "#82d8ff", forca * 0.65);
    }
    this._particulas(ctx, 482, 214, t, 67, "#abccff", 0.65, 494, true);
    this._glitch(ctx, t, forca);
    this._onda(ctx, 480, 220, 18 + Math.max(0, t - 5.02) * 365, "#c5bfff",
      t > 5.02 ? 1 - suaveHistoria(5.06, 6.3, t) : 0);
    for (const corte of [1.7, 3.43, 5.03]) {
      this._cor(ctx, "#cce0ff", pulsoHistoria(t, corte - 0.2, corte + 0.4) * 0.38);
    }
    const retorno = suaveHistoria(5.78, 6.91, t);
    if (retorno > 0) {
      ctx.save();
      ctx.globalAlpha *= retorno;
      this._quarto(ctx, 0.02, "explosao", 1 - retorno);
      ctx.restore();
      this._brilho(ctx, 480, 270, 520, "121,128,255", pulsoHistoria(t, 5.98, 6.9) * 0.36);
    }
  }

  _monitor(ctx, t, fase) {
    const { x, y, w, h } = MONITOR_HISTORIA;
    const quebrado = fase === "invasao" || (fase === "explosao" && t >= 4.66);
    ctx.save();
    if (fase === "explosao" && t < 4.66) ctx.translate(Math.sin(t * 72) * suaveHistoria(1.5, 4.66, t) * 3, 0);
    this._cor(ctx, "#0b0814", 1, x, y, w, h);
    if (fase === "noite" || (fase === "explosao" && !quebrado)) {
      const virtual = this.ctxVirtual;
      virtual.setTransform(this.telaVirtual.width / LARGURA, 0, 0, this.telaVirtual.height / ALTURA, 0, 0);
      this._cor(virtual, "#101122");
      const cena = CENAS_HISTORIA[fase === "noite" ? 1 : 3];
      this._combate(virtual, cena, fase === "noite" ? 0.42 + t * 0.94 : 10.17, fase !== "noite");
      const alturaVirtual = this.telaVirtual.width * h / w;
      const topoVirtual = this.telaVirtual.height - alturaVirtual - 11;
      ctx.drawImage(this.telaVirtual, 0, topoVirtual, this.telaVirtual.width, alturaVirtual, x, y, w, h);
      if (fase !== "noite") {
        for (let i = 0; i < 7; i++) {
          const barra = Math.floor((i * 11.1 + Math.floor(t * 14) * 2.41) % (h - 4));
          const largura = (Math.sin(i * 8 + t * 47) + 1) * 8;
          ctx.drawImage(this.telaVirtual, 0, topoVirtual + barra * alturaVirtual / h, 320, 4 * alturaVirtual / h,
            x + largura, y + barra, w - largura, 4);
        }
        this._glitch(ctx, t, 0.45 + t * 0.1, x, y, w, h);
      }
      this._brilho(ctx, x + w / 2, y + h * 0.52, 198, fase === "noite" ? "93,169,247" : "142,112,255",
        0.23 + Math.sin(t * 10) * 0.045);
    }
    if (quebrado) {
      for (let i = 0; i < 6; i++) {
        const a = i * 1.74;
        this._raio(ctx, x + w * 0.61, y + h * 0.68, x + w * 0.5 + Math.cos(a) * w * 0.48,
          y + h * 0.49 + Math.sin(a) * h * 0.37, 0.1, "#4c4260", 0.62, 1);
      }
    }
    ctx.restore();
  }

  _pessoasQuarto(ctx, t, fase) {
    const posicao = [
      ["p1", 222, 304, 87, 480, 1, 0.71, 1.02],
      ["p2", 747, 304, 867, 480, -1, 0.73, 1.04],
      ["p3", 317, 340, 180, 441, 1, 0.74, 0.94],
    ];
    for (const [i, [id, pertoX, pertoY, longeX, longeY, dir, pertoEscala, longeEscala]] of posicao.entries()) {
      const susto = fase === "explosao" ? suaveHistoria(1.75 + i * 0.18, 4.17, t) : Number(fase === "invasao");
      const x = misturarHistoria(pertoX, longeX, susto);
      const y = misturarHistoria(pertoY, longeY, susto);
      const reacao = Math.sin(t * (3.05 + i * 0.32) + i * 1.1);
      const escala = misturarHistoria(pertoEscala, longeEscala, susto);
      let pose = suaveHistoria(0.25, 0.72, reacao);
      if (fase !== "noite") pose = susto < 0.52 ? suaveHistoria(0.12, 0.52, susto) :
        1 + suaveHistoria(0.52, 0.92, susto);
      const quadros = fase === "noite" ? [0, 1] : [0, 2, 3];
      const indice = Math.floor(pose);
      const quadro = quadros[indice];
      const guardando = fase === "invasao" && t >= 11.42;
      const arte = this.recursos.artesHistoria?.[`${id}-${quadro}`];
      const proxima = this.recursos.artesHistoria?.[`${id}-${quadros[indice + 1]}`];
      const direcao = fase === "invasao" && i === 1 && t < 8.17 ? 1 : dir;
      if (!guardando && arte?.naturalWidth) {
        const h = 190 * escala;
        this._sombra(ctx, x, y, 52 * escala, 0.48);
        const luz = fase === "noite" ? 1.09 + 0.1 * reacao : 0.96 + 0.16 * Math.abs(reacao);
        ctx.save();
        ctx.filter = `brightness(${luz})`;
        this._sprite(ctx, this._transicaoSprite(arte, proxima, pose - indice), x,
          y - reacao * (quadro === 3 ? 1 : 2.5), h, h, direcao, reacao * 0.018);
        ctx.restore();
      } else {
        const anim = guardando ? "block" : quadro === 3 ? (i === 2 ? "block" : "hit") : quadro === 2 ? "getup" : "idle";
        this._animacao(ctx, id, anim, fase === "noite" ? t : Math.min(t, 0.12),
          x, y - reacao * 1.9, direcao, escala, reacao * 0.024);
      }
    }
  }

  _cadeiraObservador(ctx, afastar) {
    const quarto = this.recursos.artesHistoria?.quarto;
    if (!quarto?.naturalWidth) return;
    ctx.save();
    ctx.translate(314 + afastar * 23, 341);
    ctx.rotate(afastar * 0.15);
    const recorte = new Path2D("M -37 -47 L -18 -54 L 28 -54 L 41 -44 L 38 -35 L 14 -28 L 14 -14 L 33 -6 L 33 0 L 24 0 L 5 -8 L -15 1 L -25 1 L -25 -6 L -8 -15 L -8 -28 L -31 -34 Z");
    ctx.clip(recorte);
    ctx.filter = "brightness(0.79)";
    ctx.drawImage(quarto, quarto.naturalWidth * 0.196, quarto.naturalHeight * 0.45,
      quarto.naturalWidth * 0.092, quarto.naturalHeight * 0.11, -42, -56, 84, 58);
    ctx.restore();
  }

  _invasores(ctx, t) {
    for (const [id, entrada, x, y, escala, anim] of ELENCO_INVASAO) {
      const idade = t - entrada;
      if (idade < 0) continue;
      const dir = x > 520 ? -1 : 1;
      const pose = idade < 1.05 ? anim : id === "greeg" ? "block_low" :
        id === "carter" ? "idle" : id === "serena" && t > 6.4 && t < 7.24 ? "taunt" : "idle";
      const subir = id === "carter" ? Math.sin(idade * 11) * 9 : Math.max(0, 0.56 - idade) * 19;
      const inicial = pulsoHistoria(idade, 0, 0.84);
      this._brilho(ctx, x, y - 72, 126, id === "belyx" ? "149,31,225" : "91,139,253", inicial * 0.46);
      this._particulas(ctx, x, y - 65, idade, 19, id === "android67" ? "#a6eeff" : "#ac8eff",
        inicial * 0.72, 134, true);
      this._animacao(ctx, id, pose, idade < 1.05 ? idade : idade - 1.05, x, y - subir, dir, escala,
        id === "carter" ? Math.sin(idade * 4) * 0.08 : 0, id === "carter" ? 439 : y);
      if (id === "greeg") this._algemas(ctx, x + 9, y - 74 + Math.sin(t * 16) * 1.1, 0.92);
    }
  }

  _quarto(ctx, t, fase, recuo = 0) {
    const aproximacao = fase === "noite" ? suaveHistoria(4.55, 7.94, t) : recuo;
    const titulo = fase === "invasao" && t > 12;
    const afastar = suaveHistoria(1.45, 3.92, t);
    const zoomBase = fase === "noite" ? 1.27 + 0.06 * suaveHistoria(2.24, 4.53, t) :
      fase === "explosao" ? misturarHistoria(1.33, 1.035, afastar) : 1.04;
    const focoY = fase === "noite" ? 236 : fase === "explosao" ? misturarHistoria(236, 278, afastar) : 277;
    ctx.save();
    this._camera(ctx, 480, misturarHistoria(focoY, 164, aproximacao), misturarHistoria(zoomBase, 5.34, aproximacao) +
      (titulo ? 0.05 * (1 - suaveHistoria(12, 14, t)) : 0));
    this._cenario(ctx, "quarto", this.catalogo.mapas[4]?.full);
    this._monitor(ctx, t, fase);
    this._cadeiraObservador(ctx, fase === "noite" ? 0 : fase === "invasao" ? 1 : suaveHistoria(2.11, 4.17, t));
    if (fase === "invasao") {
      this._invasores(ctx, t);
      this._pessoasQuarto(ctx, t, fase);
      this._fumaca(ctx, 499, 442, t + 4, (1 - suaveHistoria(1, 8.4, t)) * 0.98, 465);
    } else {
      this._pessoasQuarto(ctx, t, fase);
    }
    if (fase === "explosao") {
      const densidade = suaveHistoria(1.65, 5.3, t);
      this._fumaca(ctx, 480, 276, t, densidade * 0.86, 330);
      this._fumaca(ctx, 495, 450, t + 4, densidade * 0.98, 465);
    }
    if (fase === "noite") this._particulas(ctx, 463, 244, t, 25, "#dce3ff", 0.31, 430);
    ctx.restore();
    if (fase === "explosao") {
      this._cor(ctx, "#090716", suaveHistoria(7.45, 8, t) * 0.83);
    }
  }

  _criarLogo() {
    const capa = this.recursos.capaMenu;
    if (!capa?.naturalWidth) return null;
    const logo = document.createElement("canvas");
    logo.width = 1000;
    logo.height = 257;
    const ctx = logo.getContext("2d", { willReadFrequently: true });
    const sx = capa.naturalWidth / 1672;
    const sy = capa.naturalHeight / 941;
    ctx.drawImage(capa, 318 * sx, 0, 1000 * sx, 257 * sy, 0, 0, 1000, 257);
    const vermelho = ctx.getImageData(0, 0, 1000, 257);
    const dados = vermelho.data;
    // Mantém as pinceladas e o lettering vermelho nos pixels da capa original.
    for (let y = 0; y < 257; y++) {
      for (let x = 0; x < 1000; x++) {
        const i = (y * 1000 + x) * 4;
        const faixa = (x < 235 || x > 802) && y > 74 && y < 116;
        const letras = x > 228 && x < 795 && y > 119 && y < 253;
        const saturacao = Math.min(dados[i] - dados[i + 1], dados[i] - dados[i + 2]);
        dados[i + 3] = faixa || letras ? 255 * limitarHistoria((saturacao - 30) / 25) : 0;
      }
    }
    ctx.putImageData(vermelho, 0, 0);
    const metal = new Path2D("M 194 151 L 224 80 L 218 53 L 353 49 L 411 47 L 430 28 L 463 0 L 500 13 L 525 0 L 560 17 L 587 3 L 614 26 L 628 44 L 702 43 L 746 50 L 785 52 L 818 62 L 833 84 L 835 109 L 822 130 L 800 148 L 767 149 L 739 139 L 704 130 L 668 129 L 630 133 L 595 132 L 545 131 L 519 135 L 471 138 L 416 140 L 376 139 L 334 140 L 280 143 L 245 145 Z");
    ctx.save();
    ctx.clip(metal);
    ctx.drawImage(capa, 318 * sx, 0, 1000 * sx, 257 * sy, 0, 0, 1000, 257);
    ctx.restore();
    return logo;
  }

  _titulo(ctx, t) {
    this._quarto(ctx, t + 12, "invasao");
    this._esfera(ctx, 481, 241, t, pulsoHistoria(t, 0, 2.3) * 0.71);
    this._cor(ctx, "#0a070f", suaveHistoria(0.57, 2.48, t) * 0.97);
    const aparecer = suaveHistoria(2.1, 2.7, t);
    this._fumaca(ctx, 480, 382, t, aparecer * 0.22, 365);
    if (this.logo && aparecer > 0) {
      ctx.save();
      ctx.globalAlpha *= aparecer;
      ctx.drawImage(this.logo, 67, 119, 826, 212);
      ctx.restore();
    }
    if (t > 2.02 && t < 2.82) {
      const p = (t - 2.02) / 0.8;
      const g = ctx.createLinearGradient(p * 1300 - 390, 252, p * 1300, 232);
      g.addColorStop(0, "#91001d00");
      g.addColorStop(0.72, "#c91a37");
      g.addColorStop(1, "#fff4d0");
      ctx.save();
      ctx.translate(0, 254);
      ctx.rotate(-0.075);
      ctx.globalAlpha *= Math.sin(Math.PI * p) * 0.96;
      ctx.fillStyle = g;
      const x = p * 1300;
      ctx.beginPath();
      ctx.moveTo(x - 390, 8);
      ctx.lineTo(x - 300, -5);
      ctx.lineTo(x - 140, -14);
      ctx.lineTo(x - 55, -11);
      ctx.lineTo(x, -15);
      ctx.lineTo(x - 71, 2);
      ctx.lineTo(x - 185, 15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (aparecer > 0) {
      ctx.save();
      ctx.globalAlpha *= suaveHistoria(2.65, 3.25, t);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff3e5";
      ctx.font = "italic 600 25px Georgia, serif";
      ctx.fillText("O jogo acabou de se tornar realidade.", 480, 374);
      ctx.restore();
    }
    this._cor(ctx, "#090711", suaveHistoria(4.49, 5, t));
  }

  _moldura(ctx) {
    const g = ctx.createRadialGradient(480, 270, 155, 480, 270, 555);
    g.addColorStop(0, "#00000000");
    g.addColorStop(1, "#070510d9");
    this._cor(ctx, g);
    this._cor(ctx, "#06050d", 1, 0, 0, LARGURA, 17);
    this._cor(ctx, "#06050d", 1, 0, ALTURA - 17, LARGURA, 17);
  }

  _legenda(ctx, fala) {
    if (!fala) return;
    ctx.textAlign = "center";
    ctx.font = "600 19px system-ui, sans-serif";
    const w = ctx.measureText(fala[3]).width + 48;
    this._cor(ctx, "#090712", 0.88, 480 - w / 2, 457, w, 49);
    ctx.fillStyle = "#f9d3b0";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillText(fala[2].toUpperCase(), 480, 474);
    ctx.fillStyle = "#fff";
    ctx.font = "600 19px system-ui, sans-serif";
    ctx.fillText(fala[3], 480, 496, 920);
  }
}
