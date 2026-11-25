"use strict";

class Jogo {
  // musica e somUI podem ser passados pré-carregados pelo main.js (loading screen).
  // Se omitidos, cria internamente (comportamento legado).
  constructor(canvas, recursos, catalogo, musica = null, somUI = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.recursos = recursos;
    this.catalogo = catalogo || { mapas: [] }; // (1) dados de mapas
    this.entrada = new Entrada();
    const palco = canvas.closest("#palco");
    this.paineisCombate = palco ? new PaineisCombate(palco, this.entrada) : null;
    this.gamepad = new GamepadNav(); // navegação por controle nos menus
    this.particulas = new Particulas();
    this.audio = new AudioFX();
    this.musica = musica || new MusicaFX();
    if (!musica) this.musica.precarregar();
    this.somUI = somUI || new SomUI();
    if (!somUI) this.somUI.precarregar();
    this.debug = false;

    this.tela = TELAS.APRESENTA;
    this.apresenta = { t: 0, fase: "fadein" }; // intro do estúdio
    this.start = this._estadoStartInicial(); // estado da tela-título (intro/attract)
    this.historia = null;
    const moldura = canvas.parentElement;
    this.acoesTitulo = moldura?.querySelector("#acoes-titulo");
    this.pularHistoria = moldura?.querySelector("#pular-historia");
    this.modoRevealT0 = 0; // marco temporal do staggered reveal do menu MODO
    this.projeteis = [];

    // Placar / rounds.
    this.roundsP1 = 0;
    this.roundsP2 = 0;
    this.roundAtual = 1;
    this.tempoRestante = TEMPO_ROUND;
    this.faseRound = "anuncio";
    this.timerFase = 0;
    this.vencedorRound = null;
    this.vencedorPartida = null;
    this.terminouPorKO = false;

    // Configuração de partida (definida nas telas MODO/SELECT).
    this.modo = "2p"; // "1p" | "2p"
    this.dificuldade = "medio";
    this.escolha = { p1: 0, p2: 1 }; // índices em PERSONAGENS
    this.confirmado = { p1: false, p2: false };

    // Game feel global.
    this.hitStop = 0; // tempo congelado restante (s)
    this.shake = 0; // intensidade atual do tremor
    this.flash = { a: 0, cor: "255,255,255", vel: 3.2 }; // clarão de transição global
    this.textoTech = null; // rótulo "TECH!" temporário ao defender agarrão
    this.cameraX = 0; // deslocamento horizontal da câmera no mundo (px)
    this.cenario = null; // palco da luta (camadas de parallax + NPCs de fundo)
    this.menuIndex = 0; // navegação da tela MODO
    this.dificuldadeIndex = 0; // navegação da tela DIFICULDADE
    this.configIndex = 0; // navegação da tela CONFIG
    this.telaAnteriorConfig = TELAS.MODO; // para onde ESC leva ao sair das configs

    // Pause da luta (overlay sobre a partida congelada).
    this.pausado = false;
    this.pauseModo = "menu"; // "menu" | "confirmarSair"
    this.pauseIndex = 0; // item do menu de pause
    this.pauseConfirmIndex = 1; // 0 = Sim, 1 = Não (começa em Não)

    this.p1 = null;
    this.p2 = null;

    // Seleção de mapa / VS Screen (NOVO).
    this.selecaoMapa = null; // instância de SelecaoMapa enquanto em TELAS.MAPA
    this.mapaEscolhido = null; // descritor do mapa confirmado
    this.vs = null; // estado da VS Screen enquanto em TELAS.VS
    this.select = null; // estado da tela SELECT (cursores, timers, efeitos)
    // Filtro CRT GLOBAL (scanlines + vinheta) aplicado em TODAS as telas.
    // Fonte de verdade: CONFIG.video.crt — só alternável no menu de Configurações.
    this.crt = CONFIG.video.crt;

    const assistir = this.acoesTitulo?.querySelector("#assistir-historia");
    assistir?.addEventListener("click", () => this._sairDoTitulo(TELAS.START));
    this.pularHistoria?.addEventListener("click", () => this._encerrarHistoria());
    for (const botao of [assistir, this.pularHistoria]) {
      botao?.addEventListener("keydown", (e) => {
        if (e.code === "Enter" || e.code === "Space") e.stopPropagation();
      });
    }

    canvas.addEventListener("click", (e) => {
      if (e.button !== 0) return;
      if (this.tela === TELAS.SELECT) this._clicarSelect(e);
      if (this.tela === TELAS.MAPA) this._clicarMapa(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.tela !== TELAS.SELECT || e.pointerType !== "mouse") return;
      const S = this.select;
      const indice = this._indiceCelulaClicada(e, SELECT_CELULAS, (i) => this._retCelulaSelect(i));
      this.canvas.style.cursor = indice < 0 || S.saindo > 0 ? "" : "pointer";
      const slot = this.confirmado.p1 ? "p2" : "p1";
      if (indice >= 0 && !this.confirmado[slot] && S.saindo === 0 && this._alterarCursorSelect(slot, indice)) {
        S.timer = TEMPO_SELECT;
        this.somUI.tocar("personagem");
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "F1") {
        e.preventDefault();
        this.debug = !this.debug;
      }
    });
  }

  // Cria os lutadores conforme modo/personagens/dificuldade escolhidos.
  _criarLutadores() {
    const persP1 = PERSONAGENS[this.escolha.p1];
    const persP2 = PERSONAGENS[this.escolha.p2];

    const controleP1 = new ControleTeclado(this.entrada, "p1");
    const controleP2 =
      this.modo === "1p"
        ? new ControleIA(this.dificuldade)
        : new ControleTeclado(this.entrada, "p2");

    this.p1 = new Fighter(
      this.recursos,
      "p1",
      persP1,
      MUNDO_L / 2 - 172, // ambos começam centrados no mundo, separados ~344px
      this,
      controleP1,
    );
    this.p2 = new Fighter(
      this.recursos,
      "p2",
      persP2,
      MUNDO_L / 2 + 172,
      this,
      controleP2,
    );
    this.p1.oponente = this.p2;
    this.p2.oponente = this.p1;
    this.p1.facing = 1;
    this.p2.facing = -1;
    this.paineisCombate?.definirLutador("p1", this.p1.perfil);
    this.paineisCombate?.definirLutador("p2", this.p2.perfil);
  }

  _iniciarRound() {
    this.projeteis.length = 0;
    this.particulas.limpar();
    this.hitStop = 0;
    this.shake = 0;
    this.textoTech = null;
    this.pausado = false;
    this.pauseModo = "menu";
    this.p1.x = MUNDO_L / 2 - 172;
    this.p1.y = CHAO_Y;
    this.p1.vx = 0;
    this.p1.vy = 0;
    this.p2.x = MUNDO_L / 2 + 172;
    this.p2.y = CHAO_Y;
    this.p2.vx = 0;
    this.p2.vy = 0;
    this.cameraX = this._alvoCamera(); // posiciona a câmera de imediato
    this.p1.hp = this.p1.vidaMax;
    this.p2.hp = this.p2.vidaMax;
    this.p1.especial = 0;
    this.p2.especial = 0;
    this.p1.comboRecebido = 0;
    this.p1.comboResetTimer = 0;
    this.p2.comboRecebido = 0;
    this.p2.comboResetTimer = 0;
    for (const lutador of [this.p1, this.p2]) {
      lutador.captura = null;
      lutador.nivelVoo = 0;
      lutador.velVoo = 0;
      lutador.noChao = !lutador.perfil.vooPermanente;
      lutador.y = CHAO_Y - (lutador.perfil.vooPermanente?.altura || 0);
      lutador.recargaSombra = 0;
      lutador.recargaTeleporte = 0;
      lutador.recargaSonica = 0;
      lutador.recargaPatrulha = 0;
      lutador.recargaCasco = 0;
      lutador.recargaVento = 0;
      lutador.recargaRaios = 0;
      const entrada = this.recursos.tem(lutador.personagem, "entry");
      lutador.irPara(entrada ? ESTADOS.ENTRY : ESTADOS.IDLE, true);
    }
    this.p1.facing = 1;
    this.p2.facing = -1;
    this.tempoRestante = TEMPO_ROUND;
    this.faseRound = "anuncio";
    this.timerFase = 0;
    this.vencedorRound = null;
    this.terminouPorKO = false;
  }

  /* ---- FLUXO: Seleção de mapa → VS Screen → Início do round (sem desvios) ----
     Após confirmar os PERSONAGENS, a tela SELECT chama _irParaSelecaoMapa(). */

  // Entra na seleção de estágio. Se nenhum mapa foi descoberto, pula direto para
  // a VS (a luta usará o cenário procedural de fallback).
  _irParaSelecaoMapa() {
    const mapas = this.catalogo ? this.catalogo.mapas : [];
    if (!mapas.length) {
      this.mapaEscolhido = null;
      // Sem mapa escolhido: o Cenário cai na imagem padrão (recursos.mapa) ou no
      // fundo procedural — mesmo comportamento de antes.
      this.cenario = new Cenario(null, this.recursos ? this.recursos.mapa : null);
      this._criarLutadores();
      this._iniciarVS();
      return;
    }
    this.selecaoMapa = new SelecaoMapa(mapas);
    this.tela = TELAS.MAPA;
  }

  // Confirma o mapa: vira o estágio da luta e segue para a VS Screen.
  _confirmarMapa(mapa) {
    this.mapaEscolhido = mapa;
    if (mapa && mapa.full) this.recursos.mapa = mapa.full; // estágio da LUTA
    // Monta o palco: camadas de parallax + NPCs do mapa (ou imagem única/compat).
    this.cenario = new Cenario(mapa, this.recursos ? this.recursos.mapa : null);
    this._criarLutadores(); // criados aqui para a VS já mostrar HUD e sprites
    this._iniciarVS();
  }

  // Inicializa o estado da VS Screen (posições em ESPAÇO DE TELA, fora da câmera).
  _iniciarVS() {
    this.tela = TELAS.VS;
    this.roundAtual = 1; // a VS anuncia "ROUND 1"
    this.vs = {
      t: 0,
      scroll: 0,
      p1x: -260, // entra deslizando da borda esquerda
      p2x: LARGURA + 260, // entra deslizando da borda direita
      p1Alvo: LARGURA * 0.3, // para perto do centro-esquerda
      p2Alvo: LARGURA * 0.7, // para perto do centro-direita
    };
    this.musica.tocar("vs"); // trilha própria da VS Screen
  }

  // Chamada ao final da VS: começa de fato a partida/round.
  _comecarLutaAposVS() {
    this.roundsP1 = 0;
    this.roundsP2 = 0;
    this.roundAtual = 1;
    this.vencedorPartida = null;
    this._iniciarRound();
    this.tela = TELAS.LUTA;
    this.musica.tocar("luta");
  }

  // ---- Loop principal -------------------------------------------------------
  rodar() {
    // Música começa ao chegar na tela START (após a intro do estúdio).
    // Se por algum motivo não houver APRESENTA, toca imediatamente.
    if (this.tela !== TELAS.APRESENTA) this.musica.tocar("menu");

    let anterior = performance.now();
    const passo = (agora) => {
      const dtReal = (agora - anterior) / 1000;
      anterior = agora;
      const dt = Math.min(0.05, dtReal);

      this._atualizar(this.tela === TELAS.HISTORIA ? Math.min(0.25, dtReal) : dt);
      this._ajustarCanvasSelecao(dtReal);
      this.paineisCombate?.atualizar(
        CONFIG.video.instrucoesCombate && this.tela === TELAS.LUTA,
      );
      this._desenhar();
      this._desenharFlashGlobal(dt); // clarão de transição sobre QUALQUER tela
      if (this.menuCorteT0 != null) {
        const progresso = (agora - this.menuCorteT0) / 280;
        if (progresso >= 1) this.menuCorteT0 = null;
        else (this.menuVisual ??= new MenuVisual()).desenharCorte(this.ctx, progresso);
      }

      this.entrada.confirmar = false;
      this.entrada.voltar = false;
      this.entrada.bordas.length = 0;
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  _atualizar(dt) {
    // --- Intro do estúdio ---
    if (this.tela === TELAS.APRESENTA) {
      this._atualizarApresenta(dt);
      this.entrada.limparPendentes();
      return;
    }
    // --- Telas de menu ---
    if (this.tela === TELAS.START) {
      this._atualizarStart(dt);
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.HISTORIA) {
      const gp = this.gamepad.ler();
      if (this.entrada.borda("Enter") || this.entrada.borda("Escape") ||
          gp.confirm || gp.back) this._encerrarHistoria();
      else if (!this.historia.atualizar(dt)) this._encerrarHistoria(TELAS.MODO);
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.MODO) {
      this._atualizarModo();
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.DIFICULDADE) {
      this._atualizarDificuldade();
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.SELECT) {
      this._atualizarSelect(dt);
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.MAPA) {
      this._atualizarMapa();
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.VS) {
      this._atualizarVS(dt);
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.CONFIG) {
      this._atualizarConfig();
      this.entrada.limparPendentes();
      return;
    }

    if (this.tela === TELAS.VITORIA) {
      this.p1.atualizar(dt, false);
      this.p2.atualizar(dt, false);
      this.particulas.atualizar(dt);

      const gp = this.gamepad.ler();

      // Navegação entre as opções (W/S, setas, analógico).
      const subiu  = this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp")   || (gp && gp.up);
      const desceu = this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown") || (gp && gp.down);
      if (subiu || desceu) {
        this.vitoMenu = this.vitoMenu === 0 ? 1 : 0;
        this.somUI.tocar("navegar");
      }

      // Confirmar opção selecionada (Enter, F, botão A).
      if (this.entrada.confirmar || this.entrada.borda(TECLAS.p1.soco) || (gp && gp.confirm)) {
        this.somUI.tocar("confirmar");
        if (this.vitoMenu === 0) {
          this._comecarLutaAposVS(); // mesmos lutadores e mapa
        } else {
          this.musica.tocar("menu");
          this._entrarModo();
        }
      }

      // ESC → menu principal diretamente.
      if (this.entrada.voltar || (gp && gp.back)) {
        this.somUI.tocar("voltar");
        this.musica.tocar("menu");
        this._entrarModo();
      }

      this.entrada.limparPendentes();
      return;
    }

    // ----- Tela de LUTA -----
    // Pause: enquanto pausado, a luta fica congelada e só o menu responde.
    if (this.pausado) {
      this._atualizarPause();
      this.entrada.limparPendentes();
      return;
    }
    // ESC abre o menu de pause (exceto na transição de fim de round).
    if (this.entrada.voltar && this.faseRound !== "fim") {
      this.pausado = true;
      this.pauseModo = "menu";
      this.pauseIndex = 0;
      this.somUI.tocar("navegar");
      this.entrada.voltar = false;
      this.entrada.limparPendentes();
      return;
    }

    this._atualizarShake(dt);
    this._atualizarCamera(dt);
    if (this.cenario) this.cenario.atualizar(dt); // anima NPCs de fundo
    this.timerFase += dt;

    if (this.faseRound === "anuncio") {
      this.p1.atualizar(dt, false);
      this.p2.atualizar(dt, false);
      this.particulas.atualizar(dt);
      if (this.timerFase > 1.6) {
        this.faseRound = "lutando";
        this.timerFase = 0;
      }
      this.entrada.limparPendentes();
      return;
    }

    if (this.faseRound === "lutando") {
      // HIT STOP: congela lutadores/projéteis, mas mantém partículas e shake.
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        this.particulas.atualizar(dt);
        return; // NÃO limpa pendentes: o input fica bufferizado para o combo.
      }

      this.tempoRestante -= dt;
      if (this.tempoRestante <= 0) {
        this.tempoRestante = 0;
        this._encerrarRound(this._vencedorPorVida(), false);
      }

      this.p1.atualizar(dt, true);
      this.p2.atualizar(dt, true);
      this._resolverColisaoCorpos();
      // Throw tech ANTES de resolver golpes: se ambos estão agarrando, o agarrão
      // é cancelado antes que qualquer um aplique dano/arremesso.
      this._resolverThrowTech();
      this._resolverGolpes();
      this._atualizarProjeteis(dt);
      this.particulas.atualizar(dt);
      if (this.textoTech && this.textoTech.t > 0) this.textoTech.t -= dt;

      if (this.p1.hp <= 0) this._encerrarRound("p2", true);
      else if (this.p2.hp <= 0) this._encerrarRound("p1", true);

      this.entrada.limparPendentes();
      return;
    }

    if (this.faseRound === "fim") {
      this.p1.atualizar(dt, false);
      this.p2.atualizar(dt, false);
      this._atualizarProjeteis(dt);
      this.particulas.atualizar(dt);
      if (this.timerFase > 2.6) {
        if (this.vencedorPartida) {
          this.vitoMenu = 0; // 0 = jogar novamente, 1 = menu principal
          this.tela = TELAS.VITORIA;
          this.musica.tocar("vitoria");
        } else {
          this.roundAtual++;
          this._iniciarRound();
        }
      }
      this.entrada.limparPendentes();
      return;
    }
  }

  /* =========================================================================
     TELA "MANSÃO STUDIOS APRESENTA" — intro do estúdio antes do menu.
     Fases: fadein → hold → fadeout → (transição para START).
     Pulável a qualquer momento (após 0.5 s para evitar clique acidental).
     ========================================================================= */
  _atualizarApresenta(dt) {
    const A = this.apresenta;
    const T_FADEIN = 0.7,
      T_HOLD = 4,
      T_FADEOUT = 0.7;
    A.t += dt;

    const gp = this.gamepad.ler();
    // Só permite skip após 0.5 s (evita pular por tecla pressionada antes).
    const tecla = A.t > 0.5 && this._algumInput(gp);

    if (A.fase === "fadein") {
      if (A.t >= T_FADEIN) {
        A.fase = "hold";
        A.t = 0;
      }
      if (tecla) {
        A.fase = "fadeout";
        A.t = 0;
      }
      return;
    }
    if (A.fase === "hold") {
      if (A.t >= T_HOLD || tecla) {
        A.fase = "fadeout";
        A.t = 0;
      }
      return;
    }
    if (A.fase === "fadeout") {
      if (A.t >= T_FADEOUT) {
        this.apresenta = { t: 0, fase: "fadein" }; // reseta para segurança
        this.tela = TELAS.START;
        this.musica.tocar("menu"); // inicia música do menu agora
      }
      return;
    }
  }

  _desenharApresenta(ctx) {
    const A = this.apresenta;
    const T_FADEIN = 0.7,
      T_FADEOUT = 0.7;

    let alpha = 1;
    if (A.fase === "fadein") alpha = Math.min(1, A.t / T_FADEIN);
    else if (A.fase === "fadeout") alpha = Math.max(0, 1 - A.t / T_FADEOUT);

    // Fundo preto absoluto (sem textura de jogo).
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // Scanlines sutis para reforçar o tom retrô (respeita o filtro CRT global).
    if (this.crt) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = "#000000";
      for (let y = 0; y < ALTURA; y += 2) ctx.fillRect(0, y, LARGURA, 1);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.imageSmoothingEnabled = false;

    // Linha principal — "— MANSÃO STUDIOS —"
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px 'Courier New', monospace";
    try {
      ctx.letterSpacing = "4px";
    } catch (e) {}
    ctx.fillText("— MANSÃO STUDIOS —", LARGURA / 2, ALTURA / 2 - 14);

    // Subtítulo — "APRESENTA"
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "bold 17px 'Courier New', monospace";
    try {
      ctx.letterSpacing = "7px";
    } catch (e) {}
    ctx.fillText("APRESENTA", LARGURA / 2, ALTURA / 2 + 18);
    try {
      ctx.letterSpacing = "0px";
    } catch (e) {}

    ctx.restore();
  }

  /* =========================================================================
     TELA-TÍTULO (START) — máquina de estados da abertura.
     Fases: "intro" (cinemática) → "titulo" (PRESS ANY KEY) → "attract" (demo de
     retratos após ociosidade) → "saindo" (transição para o menu). Qualquer
     tecla pula a intro, dispara o início pelo título e sai do attract.
     ========================================================================= */
  _estadoStartInicial() {
    return {
      fase: "intro", // "intro" | "titulo" | "attract" | "saindo"
      t: 0, // tempo decorrido NA FASE atual (s)
      ocioso: 0, // tempo sem input no título (dispara attract aos 10s)
      attractIdx: 0, // índice do retrato atual no slideshow do attract
      flashImpacto: 0, // 1→0: clarão + tremor do impacto do logo
      bateu: false, // trava: o impacto do logo só dispara uma vez
    };
  }

  // Dispara um clarão de transição (cor "r,g,b"). vel = taxa de decaimento.
  _flash(cor = "255,255,255", vel = 3.2) {
    this.flash.cor = cor;
    this.flash.vel = vel;
    this.flash.a = 1;
  }

  // Desenha e decai o clarão de transição global (acima de qualquer tela).
  _desenharFlashGlobal(dt) {
    if (this.flash.a <= 0) return;
    this.ctx.fillStyle = `rgba(${this.flash.cor},${this.flash.a})`;
    this.ctx.fillRect(0, 0, LARGURA, ALTURA);
    this.flash.a = Math.max(0, this.flash.a - dt * this.flash.vel);
  }

  // Entra na tela MODO rearmando o staggered reveal dos itens (baixo→cima).
  _entrarModo(index = 0) {
    this.menuIndex = index;
    this.modoRevealT0 = performance.now();
    this.tela = TELAS.MODO;
  }

  // "Qualquer tecla" (teclado, ENTER/ESC ou gamepad), ignorando toggles globais
  // (F1 debug, teclas de função, etc.) para que não pulem a intro nem avancem a tela.
  _algumInput(gp) {
    const borda = this.entrada.bordas.some((c) => !START_IGNORAR_TECLAS.has(c));
    return (
      borda ||
      this.entrada.confirmar ||
      this.entrada.voltar ||
      (gp && (gp.confirm || gp.back))
    );
  }

  _atualizarStart(dt) {
    const S = this.start;
    const T = START_TIMING;
    S.t += dt;
    if (S.flashImpacto > 0)
      S.flashImpacto = Math.max(0, S.flashImpacto - dt * 3);
    const gp = this.gamepad.ler();
    const tecla = this._algumInput(gp);

    if (S.fase === "intro") {
      // No instante do impacto, dispara clarão + tremor (uma única vez).
      if (!S.bateu && S.t >= T.impacto) {
        S.bateu = true;
        S.flashImpacto = 1;
      }
      // Pulável a qualquer momento; ou termina sozinha em introTotal.
      if (tecla || S.t >= T.introTotal) {
        S.fase = "titulo";
        S.t = 0;
        S.ocioso = 0;
      }
      return;
    }

    if (S.fase === "titulo") {
      if (this.entrada.borda("KeyH")) {
        this._sairDoTitulo(TELAS.START);
        return;
      }
      if (tecla) {
        this._sairDoTitulo();
        return;
      }
      if (this.acoesTitulo?.contains(document.activeElement)) S.ocioso = 0;
      else S.ocioso += dt;
      if (S.ocioso >= T.ociosoAttract) {
        S.fase = "attract";
        S.t = 0;
        S.attractIdx = 0;
      }
      return;
    }

    if (S.fase === "attract") {
      if (tecla) {
        S.fase = "titulo";
        S.t = 0;
        S.ocioso = 0;
        return;
      }
      if (S.t >= T.attractPorSlide) {
        S.t = 0;
        S.attractIdx = (S.attractIdx + 1) % PERSONAGENS.length;
      }
      return;
    }

    if (S.fase === "saindo") {
      if (S.t >= T.saida) {
        this.historia = new Historia(this, S.destinoHistoria);
        this.tela = TELAS.HISTORIA;
      }
      return;
    }
  }

  // Dispara a saída do título para o menu: garante áudio (1º gesto), toca o
  // som de confirmação e a música do menu, e entra na transição "saindo".
  _sairDoTitulo(destino = TELAS.MODO) {
    if (this.tela !== TELAS.START || this.start.fase !== "titulo") return;
    this.audio.garantir();
    this.somUI.tocar("confirmar");
    this.musica.tocar("menu");
    this.start.fase = "saindo";
    this.start.t = 0;
    this.start.destinoHistoria = destino;
  }

  _encerrarHistoria(destino = this.historia?.destino) {
    if (!this.historia) return;
    this.historia.encerrar();
    this.historia = null;
    this._flash("9,7,17", 2.5);
    if (destino === TELAS.START) {
      this.start = this._estadoStartInicial();
      this.start.fase = "titulo";
      this.tela = TELAS.START;
    } else {
      this._entrarModo();
    }
  }

  // --- Tela MODO: 1 Jogador / 2 Jogadores / Configurações ---
  _atualizarModo() {
    const total = 3;
    const anteriorIndex = this.menuIndex;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.menuIndex = (this.menuIndex + total - 1) % total;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.menuIndex = (this.menuIndex + 1) % total;
    if (this.menuIndex !== anteriorIndex) {
      this.somUI.tocar("navegar");
      this.audio.navegacaoMetalMenu();
    }

    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.start = this._estadoStartInicial(); // replay da cinemática de abertura
      this.tela = TELAS.START;
      return;
    }

    if (this.entrada.confirmar) {
      this.somUI.tocar("confirmar");
      this.menuCorteT0 = performance.now();
      if (this.menuIndex === 0) {
        // 1 Jogador → tela intermediária de dificuldade.
        this.dificuldadeIndex = 1; // começa selecionado em Médio
        this.dificuldadeRevealT0 = this.menuCorteT0;
        this.tela = TELAS.DIFICULDADE;
      } else if (this.menuIndex === 1) {
        // 2 Jogadores → direto para seleção de personagem.
        this.modo = "2p";
        this._iniciarSelect();
      } else {
        // Configurações.
        this.telaAnteriorConfig = TELAS.MODO;
        this.configIndex = 0;
        this.tela = TELAS.CONFIG;
      }
    }
  }

  // --- Tela DIFICULDADE: fácil / médio / difícil (só para 1 Jogador) ---
  _atualizarDificuldade() {
    const total = 3;
    const anteriorIndex = this.dificuldadeIndex;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.dificuldadeIndex = (this.dificuldadeIndex + total - 1) % total;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.dificuldadeIndex = (this.dificuldadeIndex + 1) % total;
    if (this.dificuldadeIndex !== anteriorIndex) this.somUI.tocar("navegar");

    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this._entrarModo(0);
      return;
    }

    if (this.entrada.confirmar) {
      const dificuldades = ["facil", "medio", "dificil"];
      this.modo = "1p";
      this.dificuldade = dificuldades[this.dificuldadeIndex];
      this.somUI.tocar("confirmar");
      this._iniciarSelect();
    }
  }

  /* =========================================================================
     TELA SELECT — grade arcade com cursores INDEPENDENTES de P1 e P2.
     Estado em this.select: cursores (índice na grade SELECT_CELULAS), timers de
     animação (intro/transição/flash), partículas de confirmação e contagem
     regressiva de "ficha". this.escolha continua sendo o índice em PERSONAGENS
     (definido só na confirmação) para a VS Screen / criação dos lutadores.
     ========================================================================= */
  _iniciarSelect() {
    this.escolha = { p1: 0, p2: 1 };
    this.confirmado = { p1: false, p2: false };
    this.select = {
      cursor: { p1: 0, p2: 1 }, // célula sob cada cursor (índice em SELECT_CELULAS)
      prevCursor: { p1: 0, p2: 1 },
      trans: { p1: 1, p2: 1 },
      flash: { p1: 0, p2: 0 }, // s restantes do glitch de confirmação
      intro: 0.7, // s restantes da animação de entrada (cortinas + flash)
      timer: TEMPO_SELECT, // contagem regressiva ("insira uma ficha")
      saindo: 0, // s restantes do selo "PRONTOS!" antes de ir ao mapa
      particulas: [], // faíscas leves disparadas na confirmação
    };
    this.tela = TELAS.SELECT;
  }

  _alterarCursorSelect(slot, indice) {
    const S = this.select;
    if (indice === S.cursor[slot]) return false;
    S.prevCursor[slot] = S.cursor[slot];
    S.cursor[slot] = indice;
    S.trans[slot] = 0;
    return true;
  }

  _moverCursorSelect(slot, kl, kr, ku, kd, gp) {
    const cols = SELECT_COLS,
      linhas = SELECT_LINHAS,
      n = SELECT_CELULAS.length;
    const i = this.select.cursor[slot];
    const col = i % cols,
      lin = Math.floor(i / cols);
    const horizontal = Number(Boolean(this.entrada.borda(kr) || gp?.right))
      - Number(Boolean(this.entrada.borda(kl) || gp?.left));
    if (horizontal) return this._alterarCursorSelect(slot, (i + horizontal + n) % n);
    const vertical = Number(Boolean(this.entrada.borda(kd) || gp?.down))
      - Number(Boolean(this.entrada.borda(ku) || gp?.up));
    if (!vertical) return false;
    if (linhas === 1) return this._alterarCursorSelect(slot, (i + vertical * Math.ceil(n / 2) + n) % n);
    const linha = (lin + vertical + linhas) % linhas;
    return this._alterarCursorSelect(slot, Math.min(n - 1, linha * cols + col));
  }

  _confirmarSelect(slot) {
    const S = this.select;
    const cel = SELECT_CELULAS[S.cursor[slot]];
    let idx;
    if (cel.tipo === "pers") {
      idx = PERSONAGENS.indexOf(cel.pers);
    } else {
      idx = Math.floor(Math.random() * PERSONAGENS.length);
      // Move o cursor para o lutador sorteado (feedback visual do "?").
      const indice = SELECT_CELULAS.findIndex(
        (c) => c.tipo === "pers" && PERSONAGENS.indexOf(c.pers) === idx,
      );
      this._alterarCursorSelect(slot, indice);
    }
    this.escolha[slot] = idx;
    this.confirmado[slot] = true;
    S.flash[slot] = 0.45;
    this.somUI.tocar("selecionar");
    // Faíscas temáticas no painel do jogador.
    const cor = SELECT_TEMA[slot].cor;
    const px = slot === "p1" ? 220 : LARGURA - 220;
    for (let k = 0; k < 26; k++) {
      const ang = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 260;
      S.particulas.push({
        x: px,
        y: 250,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - 80,
        vida: 0.5 + Math.random() * 0.35,
        vidaMax: 0.85,
        raio: 1.5 + Math.random() * 2.5,
        cor,
      });
    }
  }

  _indiceCelulaClicada(evento, celulas, retangulo) {
    const area = this.canvas.getBoundingClientRect();
    const x = (evento.clientX - area.left) * (LARGURA / area.width);
    const y = (evento.clientY - area.top) * (ALTURA / area.height);
    return celulas.findIndex((_, i) => {
      const celula = retangulo(i);
      return x >= celula.x && x < celula.x + celula.w &&
        y >= celula.y && y < celula.y + celula.h;
    });
  }

  _clicarSelect(evento) {
    const S = this.select;
    if (S.saindo > 0) return;

    const slot = this.confirmado.p1 ? "p2" : "p1";
    if (this.confirmado[slot]) return;

    const indice = this._indiceCelulaClicada(evento, SELECT_CELULAS, (i) => this._retCelulaSelect(i));
    if (indice === -1) return;

    this._alterarCursorSelect(slot, indice);
    this._confirmarSelect(slot);
    S.timer = TEMPO_SELECT;
  }

  _atualizarSelect(dt) {
    const S = this.select;
    const gp = this.gamepad.ler();

    // Avanço dos timers de animação.
    if (S.intro > 0) S.intro = Math.max(0, S.intro - dt);
    for (const s of ["p1", "p2"]) {
      if (S.trans[s] < 1) S.trans[s] = Math.min(1, S.trans[s] + dt * 4.5);
      if (S.flash[s] > 0) S.flash[s] = Math.max(0, S.flash[s] - dt);
    }
    // Partículas de confirmação (gravidade leve + atrito).
    for (const p of S.particulas) {
      p.vida -= dt;
      p.vx *= Math.pow(0.25, dt);
      p.vy += 700 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    S.particulas = S.particulas.filter((p) => p.vida > 0);

    // ESC/B: cancela a(s) confirmação(ões) ou volta para a tela MODO.
    if (this.entrada.voltar || gp.back) {
      if (this.confirmado.p1 || this.confirmado.p2) {
        this.confirmado.p1 = false;
        this.confirmado.p2 = false;
        S.saindo = 0;
        S.timer = TEMPO_SELECT;
        this.somUI.tocar("voltar");
      } else {
        this.somUI.tocar("voltar");
        this._entrarModo(this.menuIndex);
      }
      return;
    }

    if (S.saindo > 0) {
      S.saindo = Math.max(0, S.saindo - dt);
      if (S.saindo === 0) this._irParaSelecaoMapa();
      return;
    }

    let houveInput = false;

    // --- P1: WASD + Soco (F); Enter também confirma quem falta. ---
    if (!this.confirmado.p1) {
      if (this._moverCursorSelect("p1", "KeyA", "KeyD", "KeyW", "KeyS", gp)) {
        houveInput = true;
        this.somUI.tocar("personagem");
      }
      if (
        this.entrada.borda(TECLAS.p1.soco) ||
        (this.modo === "1p" && (this.entrada.confirmar || gp.confirm))
      ) {
        houveInput = true;
        this._confirmarSelect("p1");
        // Em 1p, o mesmo keypress não pode vazar para a fase 2 (seleção da CPU)
        // neste mesmo frame. Reseta o timer e encerra o update deste tick.
        if (this.modo === "1p") { S.timer = TEMPO_SELECT; return; }
      }
    }

    if (this.modo === "2p") {
      // --- P2: setas + Soco (J). ---
      if (!this.confirmado.p2) {
        if (
          this._moverCursorSelect(
            "p2",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          )
        ) {
          houveInput = true;
          this.somUI.tocar("personagem");
        }
        if (this.entrada.borda(TECLAS.p2.soco)) {
          houveInput = true;
          this._confirmarSelect("p2");
        }
      }
      // Enter (atalho): confirma o primeiro que ainda falta.
      if (this.entrada.confirmar) {
        houveInput = true;
        if (!this.confirmado.p1) this._confirmarSelect("p1");
        else if (!this.confirmado.p2) this._confirmarSelect("p2");
      }
    } else {
      // 1 Player fase 2: P1 já confirmou e agora escolhe o personagem da CPU.
      if (this.confirmado.p1 && !this.confirmado.p2) {
        if (this._moverCursorSelect("p2", "KeyA", "KeyD", "KeyW", "KeyS", gp)) {
          houveInput = true;
          this.somUI.tocar("personagem");
        }
        if (
          this.entrada.borda(TECLAS.p1.soco) ||
          this.entrada.confirmar ||
          (gp && gp.confirm)
        ) {
          houveInput = true;
          this._confirmarSelect("p2");
        }
      }
    }

    // Contagem regressiva de "ficha": reinicia a cada input; ao zerar, auto-confirma.
    if (houveInput) {
      S.timer = TEMPO_SELECT;
    } else {
      S.timer = Math.max(0, S.timer - dt);
      if (S.timer === 0) {
        if (!this.confirmado.p1) this._confirmarSelect("p1");
        else if (!this.confirmado.p2) this._confirmarSelect("p2");
      }
    }

    // Ambos prontos → dispara o selo "PRONTOS!" (payoff) antes do estágio.
    if (this.confirmado.p1 && this.confirmado.p2 && S.saindo === 0) {
      S.saindo = 0.85;
      this.somUI.tocar("confirmar");
    }
  }

  _clicarMapa(evento) {
    const sel = this.selecaoMapa;
    if (!sel) return;

    const indice = this._indiceCelulaClicada(evento, sel.celulas, (i) => this._retCelulaMapa(i));
    if (indice === -1) return;

    sel.indice = indice;
    this._confirmarMapaSelecionado();
  }

  _confirmarMapaSelecionado() {
    this.somUI.tocar("confirmar");
    this._confirmarMapa(this.selecaoMapa.resolverEscolha());
  }

  // --- Tela MAPA: grade de estágios ---
  _atualizarMapa() {
    const sel = this.selecaoMapa;
    if (!sel) return;
    const gp = this.gamepad.ler();

    // ESC / B volta para a seleção de personagem (re-escolher).
    if (this.entrada.voltar || gp.back) {
      this.somUI.tocar("voltar");
      this.confirmado = { p1: false, p2: false };
      this.tela = TELAS.SELECT;
      return;
    }

    // Navegação com WRAP (teclado WASD/setas + D-pad/analógico do gamepad).
    let moveu = false;
    if (
      this.entrada.borda("KeyA") ||
      this.entrada.borda("ArrowLeft") ||
      gp.left
    )
      moveu = sel.mover(-1, 0) || moveu;
    if (
      this.entrada.borda("KeyD") ||
      this.entrada.borda("ArrowRight") ||
      gp.right
    )
      moveu = sel.mover(1, 0) || moveu;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp") || gp.up)
      moveu = sel.mover(0, -1) || moveu;
    if (
      this.entrada.borda("KeyS") ||
      this.entrada.borda("ArrowDown") ||
      gp.down
    )
      moveu = sel.mover(0, 1) || moveu;
    if (moveu) this.somUI.tocar("navegar"); // sfx de mover cursor (sfx_cursor_move)

    // Confirmar: ENTER/Espaço, A do gamepad ou o soco do P1 (F).
    if (
      this.entrada.confirmar ||
      gp.confirm ||
      this.entrada.borda(TECLAS.p1.soco)
    ) {
      this._confirmarMapaSelecionado();
    }
  }

  // --- Tela VS: linha do tempo cronometrada (ver VS_TIMING) ---
  _atualizarVS(dt) {
    const vs = this.vs;
    if (!vs) return;
    vs.t += dt;

    // Scroll seamless do fundo: px/frame → px/s (referência de 60fps).
    vs.scroll += VS_TIMING.scrollPxFrame * 60 * dt;

    // FASE 0–0.5s: lutadores deslizam das bordas até o centro (ease-out cúbico).
    const k = Math.min(1, vs.t / VS_TIMING.entrada);
    const ease = 1 - Math.pow(1 - k, 3);
    vs.p1x = -260 + (vs.p1Alvo + 260) * ease;
    vs.p2x = LARGURA + 260 + (vs.p2Alvo - (LARGURA + 260)) * ease;

    // Ao fim de TODA a linha do tempo, revela o estágio e começa o round.
    const total =
      VS_TIMING.entrada +
      VS_TIMING.confronto +
      VS_TIMING.round +
      VS_TIMING.flash;
    if (vs.t >= total) this._comecarLutaAposVS();
  }

  // --- Tela CONFIG: ajusta configurações via CONFIGS[] ---
  _atualizarConfig() {
    const total = CONFIGS.length;
    const anteriorIndex = this.configIndex;

    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.configIndex = (this.configIndex + total - 1) % total;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.configIndex = (this.configIndex + 1) % total;
    if (this.configIndex !== anteriorIndex) this.somUI.tocar("navegar");

    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      // Voltando ao menu principal: refaz o staggered reveal destacando
      // "Configurações" (item de onde se veio). Da pausa, volta para a LUTA.
      if (this.telaAnteriorConfig === TELAS.MODO) this._entrarModo(2);
      else this.tela = this.telaAnteriorConfig;
      return;
    }

    // Ajuste de valor do item selecionado.
    const item = CONFIGS[this.configIndex];
    if (!item) return;

    if (item.tipo === "slider") {
      let alterou = false;
      if (this.entrada.borda("KeyA") || this.entrada.borda("ArrowLeft")) {
        item.set(Math.max(item.min, +(item.get() - item.step).toFixed(2)));
        alterou = true;
      }
      if (this.entrada.borda("KeyD") || this.entrada.borda("ArrowRight")) {
        item.set(Math.min(item.max, +(item.get() + item.step).toFixed(2)));
        alterou = true;
      }
      if (alterou) {
        item.aplicar?.(item.get(), this);
        this.somUI.tocar("navegar");
      }
    } else if (item.tipo === "toggle") {
      if (
        this.entrada.borda("KeyA") ||
        this.entrada.borda("ArrowLeft") ||
        this.entrada.borda("KeyD") ||
        this.entrada.borda("ArrowRight") ||
        this.entrada.confirmar
      ) {
        item.set(!item.get());
        item.aplicar?.(item.get(), this);
        this.somUI.tocar("navegar");
      }
    }
  }

  // --- Menu de PAUSE: Continuar / Configurações / Sair para o menu ---
  _atualizarPause() {
    if (this.pauseModo === "confirmarSair") {
      this._atualizarPauseConfirmar();
      return;
    }

    const opcoes = 3; // 0 Continuar, 1 Configurações, 2 Sair
    const ant = this.pauseIndex;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.pauseIndex = (this.pauseIndex + opcoes - 1) % opcoes;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.pauseIndex = (this.pauseIndex + 1) % opcoes;
    if (this.pauseIndex !== ant) this.somUI.tocar("navegar");

    // ESC retoma a luta.
    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.pausado = false;
      return;
    }

    if (this.entrada.confirmar) {
      if (this.pauseIndex === 0) {
        // Continuar.
        this.somUI.tocar("voltar");
        this.pausado = false;
      } else if (this.pauseIndex === 1) {
        // Configurações: reaproveita a tela CONFIG; ao sair dela (ESC) volta
        // para a LUTA, que continua pausada e reabre este menu.
        this.somUI.tocar("confirmar");
        this.telaAnteriorConfig = TELAS.LUTA;
        this.configIndex = 0;
        this.tela = TELAS.CONFIG;
      } else {
        // Sair para o menu: pede confirmação antes.
        this.somUI.tocar("confirmar");
        this.pauseModo = "confirmarSair";
        this.pauseConfirmIndex = 1; // padrão seguro: "Não"
      }
    }
  }

  // --- Confirmação "Sair da partida?" (Sim / Não) ---
  _atualizarPauseConfirmar() {
    const ant = this.pauseConfirmIndex;
    if (
      this.entrada.borda("KeyA") ||
      this.entrada.borda("ArrowLeft") ||
      this.entrada.borda("KeyD") ||
      this.entrada.borda("ArrowRight")
    ) {
      this.pauseConfirmIndex = this.pauseConfirmIndex === 0 ? 1 : 0;
    }
    if (this.pauseConfirmIndex !== ant) this.somUI.tocar("navegar");

    // ESC cancela e volta ao menu de pause.
    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.pauseModo = "menu";
      return;
    }

    if (this.entrada.confirmar) {
      if (this.pauseConfirmIndex === 0) {
        this._sairParaMenu(); // Sim
      } else {
        this.somUI.tocar("voltar"); // Não
        this.pauseModo = "menu";
      }
    }
  }

  // Encerra a partida e retorna ao menu principal.
  _sairParaMenu() {
    this.somUI.tocar("confirmar");
    this.pausado = false;
    this.pauseModo = "menu";
    this.musica.tocar("menu");
    this._entrarModo();
  }

  // --- Screen shake: decai com o tempo ---
  _atualizarShake(dt) {
    if (this.shake > 0) {
      this.shake -= dt * 60; // decaimento
      if (this.shake < 0) this.shake = 0;
    }
  }
  _tremor(intensidade) {
    this.shake = Math.max(this.shake, intensidade);
  }

  // Posição-alvo da câmera (px no mundo): centraliza o meio dos dois lutadores
  // na tela, travando nas bordas do mundo para nunca mostrar fora da arena.
  _alvoCamera() {
    if (!this.p1 || !this.p2) return 0;
    const meio = (this.p1.x + this.p2.x) / 2;
    let cam = meio - LARGURA / 2;
    const max = MUNDO_L - LARGURA;
    if (cam < 0) cam = 0;
    if (cam > max) cam = max;
    return cam;
  }

  // Move a câmera suavemente em direção ao alvo (segue a luta sem solavancos).
  _atualizarCamera(dt) {
    const alvo = this._alvoCamera();
    this.cameraX += (alvo - this.cameraX) * Math.min(1, dt * 8);
  }

  _resolverColisaoCorpos() {
    if (this.p1.patrulha || this.p2.patrulha) return;
    const golpeP1 = this.p1.captura?.golpe;
    const golpeP2 = this.p2.captura?.golpe;
    if (((golpeP1?.suplex || golpeP1?.projecao) && this.p2.estado === ESTADOS.CAPTURED) ||
        ((golpeP2?.suplex || golpeP2?.projecao) && this.p1.estado === ESTADOS.CAPTURED)) return;
    const a = this.p1.hurtbox();
    const b = this.p2.hurtbox();
    if (!colideAABB(a, b)) return;

    // ── CROSSOVER JUMP ────────────────────────────────────────────────────────
    // Se um lutador está no ar com os pés acima de alturaMinCrossover relativo
    // aos pés do oponente, suspende a separação horizontal — isso permite pular
    // por cima do adversário e pousar do outro lado.
    // O facing já atualiza automaticamente ao cruzar o x do oponente (durante
    // JUMP o podeAgir() é true, então o facing recalcula frame a frame).
    const limiar = CONFIG.movimento.alturaMinCrossover;
    if (!this.p1.noChao && this.p1.y < this.p2.y - limiar) return; // p1 cruzando
    if (!this.p2.noChao && this.p2.y < this.p1.y - limiar) return; // p2 cruzando
    // ─────────────────────────────────────────────────────────────────────────

    const sobreposicao = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const metade = sobreposicao / 2;
    if (this.p1.x < this.p2.x) {
      this.p1.x -= metade;
      this.p2.x += metade;
    } else {
      this.p1.x += metade;
      this.p2.x -= metade;
    }
    this.p1.limitarVooNaArena();
    this.p2.limitarVooNaArena();
  }

  /* THROW TECH — defesa de agarrão (vale para os dois lados ao mesmo tempo).
     Dispara quando AMBOS estão no estado GRAB, perto o bastante e com os inícios
     dos agarrões dentro de CONFIG.throwTech.janelaMs um do outro. Resultado:
     ninguém toma dano nem é arremessado; os dois entram em THROW_TECH e voltam
     ao neutro. Roda ANTES de _resolverGolpes, então cancela o agarrão antes que
     ele aplique qualquer efeito. Não toca em combos/bloqueios/outros estados. */
  _resolverThrowTech() {
    const a = this.p1;
    const b = this.p2;
    // Só há clash se os dois estiverem efetivamente agarrando.
    if (a.estado !== ESTADOS.GRAB || b.estado !== ESTADOS.GRAB) return false;
    // Os agarrões precisam ter começado dentro da janela um do outro.
    const janela = CONFIG.throwTech.janelaMs / 1000;
    if (Math.abs(a.estadoTempo - b.estadoTempo) > janela) return false;
    // E estar no alcance de agarrão (evita tech "à distância" por coincidência).
    if (Math.abs(a.x - b.x) > CONFIG.throwTech.alcance) return false;

    // Clash! Cancela os dois agarrões simultaneamente.
    a.techThrow(b.x);
    b.techThrow(a.x);

    // Feedback de "tech break": faíscas no ponto médio, som e um tremor leve.
    const mx = (a.x + b.x) / 2;
    const my = CHAO_Y - 110;
    this.particulas.faiscas(
      mx,
      my,
      CONFIG.particulas.faiscasBloqueio + 4,
      "#ffe9a8",
      200,
    );
    this.audio.bloqueio();
    this.hitStop = Math.max(this.hitStop, 0.05);
    this._tremor(CONFIG.gameFeel.shakeHit * 0.5);
    this.textoTech = { t: 0.7, x: mx, y: my - 30 }; // rótulo "TECH!" temporário
    return true;
  }

  _resolverGolpes() {
    this._checarGolpe(this.p1, this.p2);
    this._checarGolpe(this.p2, this.p1);
    this._resolverRaios(this.p1, this.p2);
    this._resolverRaios(this.p2, this.p1);
  }

  _resolverRaios(atacante, alvo) {
    if (atacante.estado !== ESTADOS.LIGHTNING) return;
    const { raio, dano, knockback } = atacante.perfil.invocacaoRaios;
    for (const raioPrevisto of atacante.raios) {
      if (raioPrevisto.atingiu || atacante.estadoTempo < raioPrevisto.tempo) continue;
      raioPrevisto.atingiu = true;
      const x = raioPrevisto.x;
      this.audio.trovaoMorgana();
      this.particulas.faiscas(x, CHAO_Y - 8, 12, "#fbc1ee", 170);
      this._tremor(4);
      const coluna = { x: x - raio, y: 0, w: raio * 2, h: CHAO_Y };
      if (!alvo.estaVivo() || !colideAABB(coluna, alvo.hurtbox())) continue;
      const res = alvo.receberGolpe({ dano, knockback, origemX: atacante.x });
      this._feedbackAcerto(atacante, alvo, res, res.dano ?? dano, x, alvo.y - 68, false);
    }
  }

  _checarGolpe(atacante, alvo) {
    if (atacante.captura) {
      const { golpe, hit, soltar, distancia, lado } = atacante.captura;
      const projeta = golpe.suplex || golpe.projecao;
      if (alvo.estado !== ESTADOS.CAPTURED || atacante.estado !== ESTADOS.GRAB) {
        atacante.captura = null;
        if (alvo.estado === ESTADOS.CAPTURED) alvo.irPara(ESTADOS.IDLE, true);
      } else if (atacante.estadoTempo >= soltar) {
        atacante.captura = null;
        if (projeta) {
          this._posicionarProjecao(atacante, alvo, distancia, lado, 1, golpe.suplex);
          this.particulas.poeira(alvo.x, CHAO_Y, 14);
          this._tremor(CONFIG.gameFeel.shakeProjetil);
        }
        const impacto = projeta ? { x: alvo.x - 10, y: alvo.y - 28, w: 20, h: 28 } : hit;
        this._aplicarGolpe(atacante, alvo, golpe, impacto, golpe.tipo_altura);
        if (alvo.estado === ESTADOS.CAPTURED) alvo.irPara(ESTADOS.IDLE, true);
      } else if (projeta) {
        const progresso = Math.max(0, 1 - (soltar - atacante.estadoTempo) / golpe.captura);
        this._posicionarProjecao(atacante, alvo, distancia, lado, progresso, golpe.suplex);
      }
      return;
    }
    const g = atacante.golpeCorporalAtivo();
    if (!g || atacante.ultimoImpacto === g) return;
    const hit = atacante.hitbox(g);
    if (!hit) return;
    if (!alvo.estaVivo()) return;
    if (g.alvoNoChao && !alvo.noChao) return;
    // HITBOX INFERIOR: o golpe testa colisão contra a REGIÃO da hurtbox que
    // corresponde à sua altura. Um golpe "baixo" precisa alcançar o quadrante
    // inferior (pernas/pés); um "alto" passa por cima de quem está agachado.
    const tipoAltura = (g && g.tipo_altura) || "medio";
    const alvoBox = alvo.hurtboxPara(tipoAltura);
    if (colideAABB(hit, alvoBox)) {
      if (g.captura && alvo.invencivel <= 0 && alvo.estado !== ESTADOS.CAPTURED &&
        alvo.estado !== ESTADOS.SHELL_GUARD) {
        atacante.captura = {
          golpe: g, hit, soltar: atacante.estadoTempo + g.captura,
          distancia: Math.abs(alvo.x - atacante.x),
          lado: atacante.facing,
        };
        atacante.ultimoImpacto = g;
        alvo.vx = 0;
        alvo.vy = 0;
        alvo.irPara(ESTADOS.CAPTURED, true);
        this.audio.bloqueio();
        return;
      }
      this._aplicarGolpe(atacante, alvo, g, hit, tipoAltura);
    }
  }

  _posicionarProjecao(atacante, alvo, distancia, lado, progresso, suplex) {
    const voo = alvo.perfil.vooPermanente;
    const salto = suplex ? 108 * Math.sin(Math.PI * progresso)
      : 26 * Math.sin(Math.PI * Math.min(1, progresso / 0.64));
    const deslocamento = suplex ? distancia * Math.cos(Math.PI * progresso)
      : distancia + 14 * Math.min(1, progresso / 0.64);
    const centroX = atacante.x + lado * deslocamento;
    alvo.x = Math.max(40, Math.min(MUNDO_L - 40, centroX));
    alvo.y = CHAO_Y - (voo ? Math.min(voo.maxima, Math.max(voo.altura, salto)) : salto);
    alvo.vx = 0;
    alvo.vy = 0;
    alvo.anguloCaptura = lado * (suplex ? progresso * Math.PI * 2
      : Math.min(1, progresso / 0.64) * Math.PI * 0.49);
    alvo.noChao = !voo && progresso === 1;
  }

  _aplicarGolpe(atacante, alvo, g, hit, tipoAltura) {
    const res = alvo.receberGolpe({
      dano: g.dano,
      knockback: g.knockback,
      empurraoFixo: g.empurraoFixo,
      derruba: g.derruba,
      origemX: atacante.x,
      ignoraBloqueio: !!g.ignoraBloqueio,
      tipoAltura, // usado pela validação de DEFESA_ALTA vs DEFESA_BAIXA
    });
    atacante.ultimoImpacto = g;

    // Abre a janela de cancelamento se o golpe for cancelável (combo).
    if (g.cancelavel)
      atacante.janelaCancel = CONFIG.combo.janelaCancelMs / 1000;

    // Feedback (juice) — centralizado para corpo-a-corpo e agarrão.
    const px = hit.x + hit.w / 2;
    const py = hit.y + hit.h / 2;
    if (g.corImpacto && !res.ignorado && !res.bloqueado) {
      this.particulas.faiscas(px, py, 11, g.corImpacto, 180);
    }
    if (g.trindade != null && !res.ignorado && !res.bloqueado) this.audio.impactoTrindade(g.trindade);
    if (g.esmeralda && !res.ignorado && !res.bloqueado) {
      this.particulas.folhas(px, py, g.derruba ? 28 : 7, g.derruba ? 360 : 150);
      this.audio.capoeira(g.derruba ? "final" : "chute");
      if (g.derruba) this._tremor(CONFIG.gameFeel.shakeKO);
    }
    this._feedbackAcerto(
      atacante,
      alvo,
      res,
      res.dano ?? g.dano,
      px,
      py,
      false,
    );
  }

  _atualizarProjeteis(dt) {
    for (const p of this.projeteis) {
      p.atualizar(dt);
      const alvo = p.dono === this.p1 ? this.p2 : this.p1;
      if (p.vivo && !p.acertou && alvo.estaVivo() && colideAABB(p.caixa(), alvo.hurtbox())) {
        const res = alvo.receberGolpe({
          dano: p.dano,
          knockback: 180,
          derruba: p.tipo === "super",
          origemX: p.x,
        });
        p.acertou = true;
        if (p.forma !== "laser") p.vivo = false;
        if (p.forma === "meia-lua" && !res.ignorado)
          this.particulas.folhas(p.x, p.y, 12, 180);
        this._feedbackAcerto(p.dono, alvo, res, p.dano, p.x, p.y, true);
      }
    }
    this.projeteis = this.projeteis.filter((p) => p.vivo);

    if (this.faseRound === "lutando") {
      if (this.p1.hp <= 0) this._encerrarRound("p2", true);
      else if (this.p2.hp <= 0) this._encerrarRound("p1", true);
    }
  }

  /* Centraliza TODO o "game feel" de um acerto: hit stop, knockback (já aplicado
     no Fighter), screen shake, faíscas e som. */
  _feedbackAcerto(atacante, alvo, res, dano, px, py, ehProjetil) {
    if (!res || res.ignorado) return;

    if (res.bloqueado) {
      this.particulas.faiscas(
        px,
        py,
        CONFIG.particulas.faiscasBloqueio,
        "#cfe8ff",
        160,
      );
      this.audio.bloqueio();
      this.hitStop = Math.max(this.hitStop, 0.03);
      this._tremor(CONFIG.gameFeel.shakeHit * 0.4);
      return;
    }

    // Ganho de especial para quem acertou.
    atacante.ganharEspecial(CONFIG.especial.ganhoAoAcertar);

    // Faíscas proporcionais ao dano (mais no projétil).
    const n = ehProjetil
      ? CONFIG.particulas.faiscasProjetil
      : CONFIG.particulas.faiscasAcerto;
    this.particulas.faiscas(
      px,
      py,
      n,
      ehProjetil ? "#fff2a8" : "#ffcf6b",
      240 + dano * 10,
    );

    if (res.ko) {
      // KO: hit stop e tremor grandes.
      this.hitStop = Math.max(this.hitStop, CONFIG.gameFeel.hitStopKO / 1000);
      this._tremor(CONFIG.gameFeel.shakeKO);
      this.particulas.faiscas(px, py, 26, "#fff", 360);
      this.audio.ko();
    } else {
      // Hit stop proporcional ao dano (com teto).
      const hs = Math.min(
        CONFIG.gameFeel.hitStopMax,
        CONFIG.gameFeel.hitStopMs + dano * CONFIG.gameFeel.hitStopPorDano,
      );
      this.hitStop = Math.max(this.hitStop, hs / 1000);
      this._tremor(
        ehProjetil
          ? CONFIG.gameFeel.shakeProjetil
          : CONFIG.gameFeel.shakeHit + dano * 0.2,
      );
      this.audio.acerto();
    }
  }

  _vencedorPorVida() {
    const p1 = this.p1.hp / this.p1.vidaMax;
    const p2 = this.p2.hp / this.p2.vidaMax;
    if (p1 > p2) return "p1";
    if (p2 > p1) return "p2";
    return "empate";
  }

  _encerrarRound(vencedor, porKO) {
    if (this.faseRound !== "lutando") return;
    this.faseRound = "fim";
    this.timerFase = 0;
    this.vencedorRound = vencedor;
    this.terminouPorKO = porKO;

    if (vencedor === "p1") {
      this.roundsP1++;
      this.p1.irPara(ESTADOS.VICTORY, true);
      if (this.p2.estaVivo()) this.p2.irPara(this.recursos.tem(this.p2.personagem, "defeat") ? ESTADOS.DEFEAT : ESTADOS.IDLE, true);
    } else if (vencedor === "p2") {
      this.roundsP2++;
      this.p2.irPara(ESTADOS.VICTORY, true);
      if (this.p1.estaVivo()) this.p1.irPara(this.recursos.tem(this.p1.personagem, "defeat") ? ESTADOS.DEFEAT : ESTADOS.IDLE, true);
    }

    if (this.roundsP1 >= ROUNDS_PARA_VENCER) this.vencedorPartida = "p1";
    else if (this.roundsP2 >= ROUNDS_PARA_VENCER) this.vencedorPartida = "p2";
  }

  // ---- Renderização ---------------------------------------------------------
  _desenhar() {
    const ctx = this.ctx;
    this._sincronizarCapaMenu();
    if (this.acoesTitulo) this.acoesTitulo.hidden = this.tela !== TELAS.START || this.start.fase !== "titulo";
    if (this.pularHistoria) this.pularHistoria.hidden = this.tela !== TELAS.HISTORIA;
    ctx.clearRect(0, 0, LARGURA, ALTURA);

    // Intro do estúdio (tela preta minimalista, antes de qualquer menu).
    if (this.tela === TELAS.APRESENTA) {
      this._desenharApresenta(ctx);
      return;
    }

    // Título, modos e dificuldade compartilham a capa atrás do canvas.
    if (this.tela === TELAS.START) {
      this._desenharStart(ctx);
      return;
    }
    if (this.tela === TELAS.HISTORIA) {
      this.historia.desenhar(ctx);
      return;
    }
    if (this.tela === TELAS.MODO) {
      this._desenharModo(ctx);
      if (this.crt) this._scanlines(ctx);
      return;
    }
    if (this.tela === TELAS.DIFICULDADE) {
      this._desenharDificuldade(ctx);
      if (this.crt) this._scanlines(ctx);
      return;
    }
    if (this.tela === TELAS.SELECT) {
      this._desenharSelect(ctx);
      return;
    }
    if (this.tela === TELAS.MAPA) {
      this._desenharMapaSelect(ctx);
      return;
    }
    if (this.tela === TELAS.VS) {
      this._desenharVS(ctx);
      return;
    }
    if (this.tela === TELAS.CONFIG) {
      this._desenharFundoMansao(ctx);
      this._desenharConfig(ctx);
      this._crtOverlay(ctx);
      return;
    }

    // Tela de vitória: arena + sprites animando e o texto central.
    if (this.tela === TELAS.VITORIA) {
      ctx.save();
      ctx.translate(-Math.round(this.cameraX), 0); // mantém a câmera da luta
      this._desenharArena(ctx);
      this.p1.desenhar(ctx, this.debug);
      this.p2.desenhar(ctx, this.debug);
      this.particulas.desenhar(ctx);
      this._desenharArenaFrente(ctx); // camadas/NPCs de primeiro plano
      ctx.restore();
      if (this.crt) this._scanlines(ctx); // filtro CRT global sobre a arena
      this._desenharVitoria(ctx);
      return;
    }

    // Tela de LUTA — mundo com screen shake + câmera que segue a luta.
    ctx.save();
    if (this.shake > 0) {
      const dx = (Math.random() - 0.5) * this.shake;
      const dy = (Math.random() - 0.5) * this.shake;
      ctx.translate(dx, dy);
    }
    ctx.translate(-Math.round(this.cameraX), 0); // desloca o mundo sob a tela
    this._desenharArena(ctx);
    if (this.p1.estado === ESTADOS.LIGHTNING || this.p2.estado === ESTADOS.LIGHTNING) {
      ctx.fillStyle = "rgba(15,4,25,0.24)";
      ctx.fillRect(Math.floor(this.cameraX) - 12, -12, LARGURA + 24, ALTURA + 24);
    }
    this.p1.desenhar(ctx, this.debug);
    this.p2.desenhar(ctx, this.debug);
    for (const p of this.projeteis) p.desenhar(ctx);
    this.particulas.desenhar(ctx);
    // Rótulo "TECH!" no ponto do clash de agarrão (sobe e some).
    if (this.textoTech && this.textoTech.t > 0) {
      const tt = this.textoTech;
      const alpha = Math.min(1, tt.t / 0.4);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ffe9a8";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 3;
      ctx.font = "bold 28px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      const y = tt.y - (0.7 - tt.t) * 40; // sobe conforme o tempo passa
      ctx.strokeText("TECH!", tt.x, y);
      ctx.fillText("TECH!", tt.x, y);
      ctx.restore();
    }
    this._desenharArenaFrente(ctx); // camadas/NPCs de primeiro plano
    ctx.restore();

    // Filtro CRT global sobre o mundo (HUD/anúncios/pause ficam nítidos acima).
    if (this.crt) this._scanlines(ctx);

    // HUD e textos centrais (fora do shake).
    this._desenharHUD(ctx);
    if (this.faseRound === "anuncio") this._desenharAnuncio(ctx);
    if (this.faseRound === "fim") this._desenharFimRound(ctx);
    if (this.pausado) this._desenharPause(ctx);
  }

  _sincronizarCapaMenu() {
    const ativo = this.tela === TELAS.START || this.tela === TELAS.MODO ||
      this.tela === TELAS.DIFICULDADE;
    if (ativo === this.capaMenuAtiva) return;
    this.capaMenuAtiva = ativo;
    this.canvas.classList.toggle("menu-capa", ativo);
    const imagem = this.recursos.capaMenu;
    if (!imagem) return;
    if (!imagem.isConnected && ativo) {
      imagem.className = "capa-menu-arte";
      imagem.alt = "";
      this.canvas.before(imagem);
    }
    imagem.hidden = !ativo;
  }

  _desenharCenario(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, ALTURA);
    g.addColorStop(0, "#2a1a3a");
    g.addColorStop(0.6, "#1a1426");
    g.addColorStop(1, "#0c0a14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    ctx.fillStyle = "rgba(255,240,200,0.12)";
    ctx.beginPath();
    ctx.arc(LARGURA * 0.78, 110, 70, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#211a2e";
    ctx.fillRect(0, CHAO_Y, LARGURA, ALTURA - CHAO_Y);
    ctx.fillStyle = "#3a2f4f";
    ctx.fillRect(0, CHAO_Y, LARGURA, 6);
  }

  // Fundo da ARENA inteira (largura = MUNDO_L). Desenhado sob a câmera.
  // Usa a imagem assets/mapas/arena.png se existir; senão, cai no procedural.
  _desenharArena(ctx) {
    // Com o palco montado, ele cuida das camadas de fundo (parallax + NPCs).
    if (this.cenario) {
      this.cenario.desenharFundo(ctx, this.cameraX);
      return;
    }
    // Compat (sem palco montado): imagem única esticada no mundo, ou procedural.
    if (this.recursos && this.recursos.mapa) {
      ctx.drawImage(this.recursos.mapa, 0, 0, MUNDO_L, ALTURA);
      return;
    }
    Cenario.desenharProcedural(ctx);
  }

  // Camadas/NPCs de PRIMEIRO PLANO (parallax > 1): passam na frente dos lutadores.
  _desenharArenaFrente(ctx) {
    if (this.cenario) this.cenario.desenharFrente(ctx, this.cameraX);
  }

  _barraVida(ctx, x, y, w, h, hp, daDireita, vidaMax = VIDA_MAX) {
    const frac = Math.max(0, hp / vidaMax);
    ctx.fillStyle = "#000";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "#5a1010";
    ctx.fillRect(x, y, w, h);
    const larguraVida = w * frac;
    let cor = "#36d23a";
    if (frac < 0.5) cor = "#e0c020";
    if (frac < 0.25) cor = "#e03020";
    ctx.fillStyle = cor;
    if (daDireita) ctx.fillRect(x + (w - larguraVida), y, larguraVida, h);
    else ctx.fillRect(x, y, larguraVida, h);
    ctx.strokeStyle = "#e8e2f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // NOVO: barra de especial (mais fina, sob a vida; brilha quando cheia).
  _barraEspecial(ctx, x, y, w, h, valor, daDireita) {
    const frac = Math.max(0, valor / CONFIG.especial.max);
    const cheia = valor >= CONFIG.especial.custo;
    ctx.fillStyle = "#000";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#101830";
    ctx.fillRect(x, y, w, h);
    const lw = w * frac;
    if (cheia) {
      const pulso = 0.6 + 0.4 * Math.sin(performance.now() / 120);
      ctx.fillStyle = `rgba(255,226,77,${pulso})`;
    } else {
      ctx.fillStyle = "#39b6ff";
    }
    if (daDireita) ctx.fillRect(x + (w - lw), y, lw, h);
    else ctx.fillRect(x, y, lw, h);
    ctx.strokeStyle = cheia ? "#ffe24d" : "#5a7aa0";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  _pipsRounds(ctx, x, y, ganhos, daDireita) {
    for (let i = 0; i < ROUNDS_PARA_VENCER; i++) {
      const px = daDireita ? x - i * 22 : x + i * 22;
      ctx.beginPath();
      ctx.arc(px, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = i < ganhos ? "#ffd34d" : "rgba(255,255,255,0.2)";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _desenharHUD(ctx) {
    const w = 360,
      h = 22,
      y = 24;
    this._barraVida(ctx, 30, y, w, h, this.p1.hp, false, this.p1.vidaMax);
    this._barraVida(ctx, LARGURA - 30 - w, y, w, h, this.p2.hp, true, this.p2.vidaMax);

    // Barras de especial (logo abaixo da vida).
    this._barraEspecial(ctx, 30, y + h + 4, w, 8, this.p1.cargaEspecialHUD, false);
    this._barraEspecial(
      ctx,
      LARGURA - 30 - w,
      y + h + 4,
      w,
      8,
      this.p2.cargaEspecialHUD,
      true,
    );

    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(this.p1.nome, 30, y + h + 34);
    ctx.textAlign = "right";
    ctx.fillText(
      this.p2.nome + (this.modo === "1p" ? "  (CPU)" : ""),
      LARGURA - 30,
      y + h + 34,
    );

    this._pipsRounds(ctx, 36, y + h + 50, this.roundsP1, false);
    this._pipsRounds(ctx, LARGURA - 36, y + h + 50, this.roundsP2, true);
    this._statusCascoHUD(ctx, this.p1, 30, y + h + 70, false);
    this._statusCascoHUD(ctx, this.p2, LARGURA - 30, y + h + 70, true);
    this._statusMagiaHUD(ctx, this.p1, 30, y + h + 70, false);
    this._statusMagiaHUD(ctx, this.p2, LARGURA - 30, y + h + 70, true);

    ctx.fillStyle = "#000";
    ctx.fillRect(LARGURA / 2 - 38, y - 4, 76, h + 8);
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 30px 'Segoe UI', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      String(Math.ceil(this.tempoRestante)).padStart(2, "0"),
      LARGURA / 2,
      y + h - 1,
    );
  }

  _textoCentral(ctx, titulo, sub, corTitulo, tamanho = 56) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, ALTURA / 2 - 70, LARGURA, 140);
    ctx.fillStyle = corTitulo || "#ffd34d";
    ctx.font = `bold ${tamanho}px 'Segoe UI', sans-serif`;
    ctx.fillText(titulo, LARGURA / 2, ALTURA / 2);
    if (sub) {
      ctx.fillStyle = "#fff";
      ctx.font = "20px 'Segoe UI', sans-serif";
      ctx.fillText(sub, LARGURA / 2, ALTURA / 2 + 42);
    }
  }

  _statusCascoHUD(ctx, lutador, x, y, direita) {
    const casco = lutador.perfil.defesaCasco;
    if (!casco) return;
    const ativo = lutador.estado === ESTADOS.SHELL_GUARD;
    const restante = ativo ? Math.max(0, casco.duracao - lutador.estadoTempo) : lutador.recargaCasco;
    const relogio = (Math.ceil(restante * 10) / 10).toFixed(1).replace(".", ",");
    const texto = ativo ? `CASCO ATIVO  ${relogio} s` : restante > 0 ? `RECARGA DO CASCO  ${relogio} s` : "CASCO PRONTO";
    ctx.save();
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    const largura = ctx.measureText(texto).width + 18;
    ctx.fillStyle = "rgba(12,18,8,0.82)";
    ctx.fillRect(direita ? x - largura : x, y - 14, largura, 19);
    ctx.fillStyle = ativo ? "#edff9c" : restante > 0 ? "#e4d798" : "#baff77";
    ctx.textAlign = direita ? "right" : "left";
    ctx.fillText(texto, x + (direita ? -9 : 9), y);
    ctx.restore();
  }

  _statusMagiaHUD(ctx, lutador, x, y, direita) {
    if (!lutador.perfil.invocacaoRaios) return;
    const rotulo = (nome, tempo) => tempo > 0 ? `${nome} ${Math.ceil(tempo)} s` : `${nome} pronto`;
    ctx.save();
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#f5b9e0";
    ctx.textAlign = direita ? "right" : "left";
    ctx.fillText(`${rotulo("Vento", lutador.recargaVento)}  •  ${rotulo("Raios", lutador.recargaRaios)}`, x, y);
    ctx.restore();
  }

  _desenharAnuncio(ctx) {
    const mostrarLutar = this.timerFase > 0.9;
    this._textoCentral(
      ctx,
      mostrarLutar ? "FIGHT!" : "ROUND " + this.roundAtual,
      null,
      mostrarLutar ? "#36d23a" : "#ffd34d",
    );
  }

  _desenharFimRound(ctx) {
    // KO recebe destaque "K.O.".
    if (this.terminouPorKO && this.timerFase < 1.3) {
      this._textoCentral(ctx, "K.O.", null, "#e03020", 96);
      return;
    }
    let texto = "EMPATE";
    if (this.vencedorRound === "p1") texto = this.p1.nome + " VENCE O ROUND";
    else if (this.vencedorRound === "p2")
      texto = this.p2.nome + " VENCE O ROUND";
    this._textoCentral(ctx, texto, null, "#ffd34d", 40);
  }

  _desenharVitoria(ctx) {
    const v = this.vencedorPartida === "p1" ? this.p1 : this.p2;
    const agora = performance.now();
    const CY = ALTURA / 2;

    // Faixa semitransparente de fundo para legibilidade.
    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.fillRect(0, CY - 66, LARGURA, 210);

    // Nome do vencedor.
    ctx.textAlign = "center";
    ctx.font = "900 42px 'Segoe UI', sans-serif";
    ctx.shadowColor = PALETA.ouro;
    ctx.shadowBlur = 28;
    ctx.fillStyle = PALETA.ouro;
    ctx.fillText(v.nome.toUpperCase() + " VENCEU!", LARGURA / 2, CY - 14);
    ctx.shadowBlur = 0;
    if (v.perfil.fraseVitoria) {
      ctx.font = "bold 18px 'Segoe UI', sans-serif";
      ctx.fillText(v.perfil.fraseVitoria, LARGURA / 2, CY + 13);
    }

    // Opções do menu pós-luta.
    const opcoes = ["JOGAR NOVAMENTE", "MENU PRINCIPAL"];
    const opcoesY = v.perfil.fraseVitoria ? [CY + 50, CY + 91] : [CY + 32, CY + 76];

    for (let i = 0; i < opcoes.length; i++) {
      const sel = i === this.vitoMenu;
      const piscando = sel && Math.floor(agora / 280) % 2 === 0;
      ctx.font = sel ? "900 24px 'Segoe UI', sans-serif" : "bold 20px 'Segoe UI', sans-serif";
      ctx.fillStyle = sel ? (piscando ? PALETA.ouro : "#ffffff") : PALETA.textoFraco;
      ctx.shadowColor = sel ? PALETA.ouro : "transparent";
      ctx.shadowBlur = sel ? 18 : 0;
      ctx.fillText((sel ? "► " : "  ") + opcoes[i], LARGURA / 2, opcoesY[i]);
    }
    ctx.shadowBlur = 0;

    // Dica de navegação no rodapé.
    ctx.fillStyle = "rgba(155,144,181,0.55)";
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.fillText("W / S para navegar   •   ENTER confirma   •   ESC volta ao menu", LARGURA / 2, ALTURA - 16);
  }

  _desenharStart(ctx) {
    (this.menuVisual ??= new MenuVisual()).desenharInicio(this, ctx, performance.now());
    if (this.crt) this._scanlines(ctx);
  }

  /* Filtro CRT compartilhado por todas as telas de menu: scanlines leves +
     vinheta radial. Alternável no menu de Configurações (this.crt). */
  _crtOverlay(ctx) {
    if (!this.crt) return;
    this._scanlines(ctx);
    const vg = ctx.createRadialGradient(
      LARGURA / 2,
      ALTURA / 2,
      ALTURA * 0.34,
      LARGURA / 2,
      ALTURA / 2,
      ALTURA * 0.82,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, LARGURA, ALTURA);
  }

  /* FUNDO "SALÃO DA MANSÃO EM RUÍNAS" — 4 planos de parallax (janela > parede
     > colunas > piso) + candelabros, poeira e relâmpago ocasional. Totalmente
     procedural e SEM estado (lê só o relógio), então é reutilizável atrás de
     qualquer tela de menu sem alocar nada. O parallax é uma oscilação suave
     (sway) — dá profundidade sem rolagem infinita num interior fechado. */
  _desenharFundoMansao(ctx) {
    const t = performance.now() / 1000;
    const sway = Math.sin(t * 0.18) * 10; // px de oscilação base

    // Relâmpago ocasional (stateless, dois períodos quase-primos p/ irregularidade).
    const i1 = t % 7.3,
      i2 = t % 4.1;
    let raio = 0;
    if (i1 < 0.16) raio = Math.max(raio, Math.pow(1 - i1 / 0.16, 1.3));
    if (i2 < 0.08) raio = Math.max(raio, 0.6 * Math.pow(1 - i2 / 0.08, 1.3));

    // Base — gradiente do interior escuro.
    const g = ctx.createLinearGradient(0, 0, 0, ALTURA);
    g.addColorStop(0, "#160e22");
    g.addColorStop(0.55, "#0b0814");
    g.addColorStop(1, "#06040b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // ===== PLANO 1 (fundo): janela com céu noturno + relâmpago =====
    const wx = LARGURA / 2 + sway * 0.3;
    const wy = 54,
      ww = 300,
      wh = 210;
    const cu = (a, b) => Math.round(a + (b - a) * raio);
    ctx.fillStyle = `rgb(${cu(26, 210)},${cu(28, 205)},${cu(48, 235)})`;
    ctx.fillRect(wx - ww / 2, wy, ww, wh);
    if (raio > 0.45) {
      // Bolt (raio) recortado pela janela.
      ctx.save();
      ctx.beginPath();
      ctx.rect(wx - ww / 2, wy, ww, wh);
      ctx.clip();
      ctx.globalAlpha = Math.min(1, (raio - 0.45) * 3);
      ctx.strokeStyle = "#eaf0ff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let bx = wx + Math.sin(t * 30) * 20,
        by = wy;
      ctx.moveTo(bx, by);
      for (let k = 0; k < 6; k++) {
        bx += Math.sin(t * 50 + k * 2.3) * 26;
        by += wh / 6;
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Caixilho em cruz + moldura da janela.
    ctx.fillStyle = "#0a0712";
    ctx.fillRect(wx - 4, wy, 8, wh);
    ctx.fillRect(wx - ww / 2, wy + wh / 2 - 4, ww, 8);
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#0a0712";
    ctx.strokeRect(wx - ww / 2, wy, ww, wh);
    // Luz do relâmpago invadindo o salão (tinge de roxo — o acento).
    if (raio > 0) {
      ctx.fillStyle = `rgba(150,140,255,${0.16 * raio})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }

    // ===== PLANO 2 (parede): retratos rasgados + rachaduras =====
    ctx.save();
    ctx.translate(sway * 0.6, 0);
    ctx.fillStyle = "rgba(30,22,46,0.55)";
    ctx.fillRect(-20, 150, LARGURA + 40, 230);
    for (const [qx, qy] of [
      [120, 210],
      [LARGURA - 150, 230],
      [250, 300],
    ]) {
      ctx.save();
      ctx.translate(qx, qy);
      ctx.rotate(Math.sin(qx) * 0.06); // torto, mas determinístico
      ctx.fillStyle = "#120c1e";
      ctx.fillRect(-34, -44, 68, 88);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(120,96,40,0.5)"; // dourado envelhecido
      ctx.strokeRect(-34, -44, 68, 88);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(420, 150);
    ctx.lineTo(440, 230);
    ctx.lineTo(415, 300);
    ctx.lineTo(450, 360);
    ctx.moveTo(700, 160);
    ctx.lineTo(685, 250);
    ctx.stroke();
    ctx.restore();

    // ===== PLANO 3 (colunas) — emolduram as laterais =====
    const off3 = sway * 0.95;
    const coluna = (cx) => {
      const cg = ctx.createLinearGradient(cx - 26, 0, cx + 26, 0);
      cg.addColorStop(0, "#0d0a16");
      cg.addColorStop(0.5, "#241a38");
      cg.addColorStop(1, "#0d0a16");
      ctx.fillStyle = cg;
      ctx.fillRect(cx - 26, 90, 52, CHAO_Y - 90);
      ctx.fillStyle = "#2c2046";
      ctx.fillRect(cx - 34, 86, 68, 16); // capitel
      ctx.fillRect(cx - 34, CHAO_Y - 14, 68, 14); // base
    };
    coluna(70 + off3);
    coluna(LARGURA - 70 + off3);

    // ===== CANDELABROS — chamas tremeluzentes (aditivo, halo roxo) =====
    const chama = (fx, fy) => {
      const fl =
        0.6 + 0.4 * Math.sin(t * 11 + fx) + 0.2 * Math.sin(t * 23 + fx);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 60 + fl * 18);
      fg.addColorStop(0, "rgba(255,180,90,0.5)");
      fg.addColorStop(0.4, "rgba(177,92,255,0.18)");
      fg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fx, fy, 60 + fl * 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,210,120,0.85)";
      ctx.beginPath();
      ctx.ellipse(fx, fy, 5 + fl, 12 + fl * 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    chama(150 + off3, 250);
    chama(LARGURA - 150 + off3, 250);

    // ===== PLANO 4 (frente): piso de mármore rachado =====
    const fgp = ctx.createLinearGradient(0, CHAO_Y, 0, ALTURA);
    fgp.addColorStop(0, "#1a1330");
    fgp.addColorStop(1, "#08060f");
    ctx.fillStyle = fgp;
    ctx.fillRect(0, CHAO_Y, LARGURA, ALTURA - CHAO_Y);
    ctx.fillStyle = "rgba(177,92,255,0.2)"; // linha de destaque (acento)
    ctx.fillRect(0, CHAO_Y, LARGURA, 3);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(300, CHAO_Y + 6);
    ctx.lineTo(360, ALTURA);
    ctx.moveTo(620, CHAO_Y + 4);
    ctx.lineTo(580, ALTURA);
    ctx.moveTo(480, CHAO_Y + 8);
    ctx.lineTo(500, ALTURA);
    ctx.stroke();

    // ===== POEIRA FLUTUANTE (motes lentos, aditivo) =====
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 42; i++) {
      const s = i * 97.13;
      const vel = 6 + (i % 5) * 3;
      const yy = ALTURA - ((t * vel + s * 11) % (ALTURA + 40));
      const xx = ((s * 53) % LARGURA) + Math.sin(t * 0.5 + i) * 18;
      ctx.globalAlpha = 0.06 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.7 + i));
      ctx.fillStyle = i % 4 === 0 ? PALETA.acentoClaro : "#d8cff0";
      ctx.beginPath();
      ctx.arc(xx, yy, 0.8 + (i % 3) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- Tela de configurações -----------------------------------------------
  // Overlay do menu de PAUSE sobre a luta congelada.
  _desenharPause(ctx) {
    // Escurece a cena.
    ctx.fillStyle = "rgba(8,6,16,0.66)";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    if (this.pauseModo === "confirmarSair") {
      this._desenharPauseConfirmar(ctx);
      return;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 52px 'Segoe UI', sans-serif";
    ctx.fillText("PAUSA", LARGURA / 2, 150);

    const opcoes = ["Continuar", "Configurações", "Sair para o Menu"];
    const itemH = 64;
    const startY = 250;
    for (let i = 0; i < opcoes.length; i++) {
      const sel = i === this.pauseIndex;
      const cy = startY + i * itemH;
      if (sel) {
        ctx.fillStyle = "rgba(255,211,77,0.12)";
        ctx.fillRect(LARGURA / 2 - 220, cy - 26, 440, 48);
      }
      ctx.fillStyle = sel ? "#ffd34d" : "#cfc6e0";
      ctx.font = sel
        ? "bold 30px 'Segoe UI', sans-serif"
        : "26px 'Segoe UI', sans-serif";
      ctx.fillText(sel ? `▸  ${opcoes[i]}  ◂` : opcoes[i], LARGURA / 2, cy + 6);
    }

    ctx.fillStyle = "#9b90b5";
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(
      "W/S ou ↑/↓ navega  •  ENTER confirma  •  ESC retoma",
      LARGURA / 2,
      478,
    );
  }

  // Caixa de confirmação "Sair da partida?".
  _desenharPauseConfirmar(ctx) {
    const bw = 540,
      bh = 230;
    const bx = LARGURA / 2 - bw / 2;
    const by = ALTURA / 2 - bh / 2;

    ctx.fillStyle = "rgba(20,16,38,0.96)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "#ffd34d";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px 'Segoe UI', sans-serif";
    ctx.fillText("Sair da partida?", LARGURA / 2, by + 64);

    ctx.fillStyle = "#9b90b5";
    ctx.font = "18px 'Segoe UI', sans-serif";
    ctx.fillText("O progresso da luta será perdido.", LARGURA / 2, by + 100);

    const labels = ["Sim", "Não"];
    const bwBtn = 160,
      bhBtn = 52;
    const gap = 40;
    const totalW = bwBtn * 2 + gap;
    const startX = LARGURA / 2 - totalW / 2;
    const btnY = by + bh - 78;
    for (let i = 0; i < 2; i++) {
      const sel = i === this.pauseConfirmIndex;
      const x = startX + i * (bwBtn + gap);
      ctx.fillStyle = sel
        ? i === 0
          ? "rgba(224,48,32,0.30)"
          : "rgba(54,210,58,0.22)"
        : "rgba(255,255,255,0.05)";
      ctx.fillRect(x, btnY, bwBtn, bhBtn);
      ctx.strokeStyle = sel ? (i === 0 ? "#e03020" : "#36d23a") : "#5a5070";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, btnY, bwBtn, bhBtn);
      ctx.fillStyle = sel ? "#ffffff" : "#cfc6e0";
      ctx.font = sel
        ? "bold 24px 'Segoe UI', sans-serif"
        : "22px 'Segoe UI', sans-serif";
      ctx.fillText(labels[i], x + bwBtn / 2, btnY + bhBtn / 2 + 8);
    }

    ctx.fillStyle = "#9b90b5";
    ctx.font = "15px 'Segoe UI', sans-serif";
    ctx.fillText(
      "←/→ escolhe  •  ENTER confirma  •  ESC cancela",
      LARGURA / 2,
      by + bh + 28,
    );
  }

  _desenharConfig(ctx) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 48px 'Segoe UI', sans-serif";
    ctx.fillText("CONFIGURAÇÕES", LARGURA / 2, 110);

    const itemH = 72;
    const startY = 164;
    const sliderW = 320; // largura da barra de slider

    for (let i = 0; i < CONFIGS.length; i++) {
      const item = CONFIGS[i];
      const sel = i === this.configIndex;
      const cy = startY + i * itemH;

      // Fundo do item selecionado.
      if (sel) {
        ctx.fillStyle = "rgba(255,211,77,0.10)";
        ctx.fillRect(LARGURA / 2 - 360, cy - 30, 720, 58);
      }

      // Label.
      ctx.fillStyle = sel ? "#ffd34d" : "#cfc6e0";
      ctx.font = sel
        ? "bold 22px 'Segoe UI', sans-serif"
        : "20px 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(item.label, LARGURA / 2 - sliderW / 2 - 24, cy + 6);

      if (item.tipo === "slider") {
        const val = item.get();
        const frac = (val - item.min) / (item.max - item.min);
        const sx = LARGURA / 2 - sliderW / 2;

        // Trilha.
        ctx.fillStyle = "#1a1430";
        ctx.fillRect(sx, cy - 8, sliderW, 16);
        ctx.strokeStyle = sel ? "#ffd34d" : "#5a5070";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, cy - 8, sliderW, 16);

        // Preenchimento.
        ctx.fillStyle = sel ? "#ffd34d" : "#7a60cc";
        ctx.fillRect(sx, cy - 8, sliderW * frac, 16);

        // Alça.
        const hx = sx + sliderW * frac;
        ctx.fillStyle = sel ? "#fff" : "#cfc6e0";
        ctx.beginPath();
        ctx.arc(hx, cy, 11, 0, Math.PI * 2);
        ctx.fill();

        // Setas e percentual.
        ctx.textAlign = "left";
        ctx.fillStyle = sel ? "#ffd34d" : "#9b90b5";
        ctx.font = sel
          ? "bold 20px 'Segoe UI', sans-serif"
          : "18px 'Segoe UI', sans-serif";
        const pct = Math.round(val * 100) + "%";
        ctx.fillText(sel ? `◀  ${pct}  ▶` : pct, sx + sliderW + 18, cy + 7);
      } else if (item.tipo === "toggle") {
        const ligado = item.get();
        ctx.textAlign = "left";
        const tx = LARGURA / 2 - sliderW / 2;
        ctx.fillStyle = ligado ? "#36d23a" : "#e03020";
        ctx.font = sel
          ? "bold 22px 'Segoe UI', sans-serif"
          : "20px 'Segoe UI', sans-serif";
        ctx.fillText(
          ligado
            ? sel
              ? "◀  LIGADO  ▶"
              : "LIGADO"
            : sel
              ? "◀  DESLIGADO  ▶"
              : "DESLIGADO",
          tx,
          cy + 7,
        );
      }
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#9b90b5";
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(
      "W/S ou ↑/↓ para navegar  •  ←/→ para ajustar  •  ESC volta",
      LARGURA / 2,
      468,
    );
  }

  _desenharModo(ctx) {
    (this.menuVisual ??= new MenuVisual()).desenharModos(this, ctx, performance.now());
  }

  // ---- Tela de seleção de dificuldade (1 Jogador) --------------------------
  _desenharDificuldade(ctx) {
    (this.menuVisual ??= new MenuVisual()).desenharDificuldade(this, ctx, performance.now());
  }

  _retCelulaSelect(indice) {
    return retanguloCelulaSelect(indice);
  }

  _ajustarCanvasSelecao(dt = 0) {
    const selecao = this.tela === TELAS.SELECT;
    if (!selecao && !this.canvasSelecaoAtivo) return;
    if (this.canvasSelecaoAtivo !== selecao) {
      this.canvasSelecaoAtivo = selecao;
      this.limiteCanvasSelecao = 3840;
      this.quadrosLentosSelecao = 0;
      this.canvas.classList.toggle("selecao-cinematica", selecao);
      if (!selecao) this.canvas.style.cursor = "";
    }
    if (selecao) {
      this.quadrosLentosSelecao = dt > 0.042 && this.canvas.width > LARGURA
        ? this.quadrosLentosSelecao + 1 : 0;
      if (this.quadrosLentosSelecao >= 6) {
        this.limiteCanvasSelecao = Math.max(LARGURA, Math.floor(this.canvas.width * 0.8));
        this.quadrosLentosSelecao = 0;
      }
    }
    const largura = selecao
      ? Math.max(LARGURA, Math.min(this.limiteCanvasSelecao, Math.round(this.canvas.clientWidth * (window.devicePixelRatio || 1))))
      : LARGURA;
    const altura = Math.round(largura * ALTURA / LARGURA);
    if (this.canvas.width !== largura || this.canvas.height !== altura) {
      this.canvas.width = largura;
      this.canvas.height = altura;
      this.ctx.setTransform(largura / LARGURA, 0, 0, altura / ALTURA, 0, 0);
    }
  }

  _desenharSelect(ctx) {
    if (!this.select) return;
    this.selecaoVisual ??= new SelecaoVisual();
    this.selecaoVisual.desenhar(this, ctx, performance.now());
  }

  /* =========================================================================
     SELEÇÃO DE MAPA + VS SCREEN — (2) MÓDULO DE UI / RENDERIZAÇÃO
     Estética arcade CRT: paleta de 4 tons (fundo púrpura escuro, ciano, âmbar,
     branco), bordas pixel (cantos marcados, sem border-radius), miniaturas em
     letterbox e cursor piscante de alto contraste.
     ========================================================================= */

  // Linhas de varredura (scanlines) leves — textura "monitor CRT".
  _scanlines(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#000";
    for (let y = 0; y < ALTURA; y += 3) ctx.fillRect(0, y, LARGURA, 1);
    ctx.restore();
  }

  // Desenha a imagem do mapa PREENCHENDO a célula (modo "cover"): escala para
  // cobrir todo o retângulo e recorta o excedente (sem barras pretas). Como os
  // mapas são bem largos (1920×540), isso mostra o miolo do estágio cheio na
  // célula. O clip garante que o excedente não vaze para fora da borda.
  // topBias: 0 = topo, 0.5 = centro (padrão), 1 = base.
  // Use 0.5 para mapas/cenários; valores menores (ex.: 0.1) para retratos de
  // personagens, evitando que a cabeça seja cortada pelo recorte "cover".
  _desenharThumb(ctx, img, x, y, w, h, topBias = 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    if (img && img.width) {
      const escala = Math.max(w / img.width, h / img.height); // COVER
      const dw = img.width * escala;
      const dh = img.height * escala;
      ctx.imageSmoothingEnabled = true; // downscale suave fica melhor
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * topBias, dw, dh);
    }
    ctx.restore();
  }

  // Cantos marcados estilo pixel-art (4 "Ls" nas quinas de um retângulo).
  _cantosPixel(ctx, x, y, w, h, t, cor) {
    ctx.fillStyle = cor;
    const c = [
      [x, y, t, t * 4],
      [x, y, t * 4, t], // sup-esq
      [x + w - t, y, t, t * 4],
      [x + w - t * 4, y, t * 4, t], // sup-dir
      [x, y + h - t * 4, t, t * 4],
      [x, y + h - t, t * 4, t], // inf-esq
      [x + w - t, y + h - t * 4, t, t * 4],
      [x + w - t * 4, y + h - t, t * 4, t], // inf-dir
    ];
    for (const r of c) ctx.fillRect(r[0], r[1], r[2], r[3]);
  }

  // Desenha o miolo da célula "ALEATÓRIO": fundo escuro + "?" grande pulsante.
  _desenharCelulaAleatoria(ctx, x, y, w, h, agora) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#241a3a");
    g.addColorStop(1, "#0c0a18");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    const pulso = 0.6 + 0.4 * Math.sin(agora / 280);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#5cd6ff";
    ctx.shadowBlur = 22 * pulso;
    ctx.fillStyle = "#ffd34d";
    ctx.font = `900 ${Math.floor(h * 0.6)}px 'Segoe UI', monospace`;
    ctx.fillText("?", x + w / 2, y + h / 2);
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  }

  // ---- Tela de SELEÇÃO DE MAPA ("SELECT STAGE") ----------------------------
  _retCelulaMapa(indice) {
    const { cols, linhas } = this.selecaoMapa;
    const areaX = 60;
    const areaY = 96;
    const areaW = LARGURA - 120;
    const areaH = 372;
    const gap = 18;
    const w = (areaW - gap * (cols - 1)) / cols;
    const h = Math.min((areaH - gap * (linhas - 1)) / linhas, w * 0.62 + 28);
    const gridH = h * linhas + gap * (linhas - 1);
    const startY = areaY + Math.max(0, (areaH - gridH) / 2);
    return {
      x: areaX + (indice % cols) * (w + gap),
      y: startY + Math.floor(indice / cols) * (h + gap),
      w,
      h,
    };
  }

  _desenharMapaSelect(ctx) {
    const sel = this.selecaoMapa;
    const agora = performance.now();
    const visual = (this.menuVisual ??= new MenuVisual());
    const quarto = this.recursos.artesHistoria?.quarto;

    if (quarto?.naturalWidth) {
      this._desenharThumb(ctx, quarto, 0, 0, LARGURA, ALTURA);
      ctx.fillStyle = "rgba(9,7,13,0.36)";
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    } else {
      this._desenharCenario(ctx);
    }
    visual.desenharTextoOpcao(ctx, "SELECT STAGE", LARGURA / 2, 66, true, 1, 35, 1, "center");

    const celulas = sel.celulas; // mapas + célula "ALEATÓRIO"
    const tiraNome = 26; // faixa do nome embaixo da miniatura

    for (let idx = 0; idx < celulas.length; idx++) {
      const { x, y, w: cellW, h: cellH } = this._retCelulaMapa(idx);
      const m = celulas[idx];
      const ehSel = idx === sel.indice;
      const thumbH = cellH - tiraNome;

      if (m.aleatorio) {
        // Célula "ALEATÓRIO": tile escuro com um "?" grande pulsante (estilo arcade).
        this._desenharCelulaAleatoria(ctx, x, y, cellW, thumbH, agora);
      } else {
        // Miniatura preenchendo a célula (cover, recortando o excedente).
        this._desenharThumb(ctx, m.full, x, y, cellW, thumbH);
      }

      ctx.fillStyle = ehSel ? "#411625" : "#1a1430";
      ctx.fillRect(x, y + thumbH, cellW, tiraNome);
      visual.desenharTextoOpcao(ctx, m.nome, x + cellW / 2, y + thumbH + 18,
        ehSel, 1, 16, Number(ehSel), "center", cellW - 10);

      // Borda pixel (cantos marcados, sem arredondamento).
      ctx.strokeStyle = "#3a2f4f";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, cellW - 3, cellH - 3);
      this._cantosPixel(ctx, x, y, cellW, cellH, 3, "#5a4a7a");

      // CURSOR animado: borda piscante de alto contraste (ciano ↔ branco).
      if (ehSel) {
        const on = Math.floor(agora / 110) % 2 === 0;
        ctx.strokeStyle = on ? "#5cd6ff" : "#ffffff";
        ctx.lineWidth = 4;
        ctx.strokeRect(x - 3, y - 3, cellW + 6, cellH + 6);
        this._cantosPixel(
          ctx,
          x - 3,
          y - 3,
          cellW + 6,
          cellH + 6,
          4,
          on ? "#ffffff" : "#5cd6ff",
        );
      }
    }

    // Rodapé com instruções.
    ctx.textAlign = "center";
    ctx.fillStyle = "#f3dcd4";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillText(
      "Clique para escolher o estágio  •  ↑ ↓ ← → mover  •  ENTER / F confirma  •  ESC volta",
      LARGURA / 2,
      ALTURA - 18,
    );

    if (this.crt) this._scanlines(ctx);
  }

  // ---- VS SCREEN -----------------------------------------------------------
  // Fundo com scroll horizontal SEAMLESS (direita → esquerda). Estruturado como
  // lista de camadas para suportar parallax: hoje há 1 camada (a imagem do mapa),
  // mas camadas extras com velocidades diferentes entrariam aqui sem retrabalho.
  _desenharScrollVS(ctx, scroll) {
    const img = this.recursos && this.recursos.mapa;
    if (!img || !img.width) {
      // Sem imagem: cai no cenário procedural (cobrindo a tela toda).
      this._desenharCenario(ctx);
      return;
    }
    // Escala a imagem para COBRIR a altura da tela, preservando a proporção.
    const escala = ALTURA / img.height;
    const sw = img.width * escala; // largura de UMA cópia desenhada
    let off = scroll % sw;
    if (off < 0) off += sw;
    ctx.imageSmoothingEnabled = false;
    // Tile horizontal: desenha cópias lado a lado até cobrir a tela (loop perfeito).
    for (let x = -off; x < LARGURA; x += sw) {
      ctx.drawImage(img, x, 0, sw, ALTURA);
    }
  }

  // Desenha um lutador (sprite idle) em ESPAÇO DE TELA, virado para o centro.
  _desenharLutadorVS(ctx, pers, x, facing) {
    const fr = this.recursos.frame(pers, "idle", 0);
    const escala = ESCALA * (this.recursos.manifest.players[pers]?.combate?.escalaSprite || 1);
    const dw = this.recursos.frameW * escala;
    const dh = this.recursos.frameH * escala;
    const dx = x - dw / 2;
    const dy = CHAO_Y - dh; // pés no chão

    // Sombra simples sob os pés.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, CHAO_Y, 72, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (facing === -1) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
    }
    if (fr && fr.ok) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(fr.img, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  // HUD da VS: barras de vida/especial, nomes e pips de round (antecipação).
  _desenharHUDVS(ctx) {
    const w = 360;
    const h = 22;
    const y = 24;
    this._barraVida(ctx, 30, y, w, h, this.p1.hp, false, this.p1.vidaMax);
    this._barraVida(ctx, LARGURA - 30 - w, y, w, h, this.p2.hp, true, this.p2.vidaMax);
    this._barraEspecial(ctx, 30, y + h + 4, w, 8, this.p1.cargaEspecialHUD, false);
    this._barraEspecial(
      ctx,
      LARGURA - 30 - w,
      y + h + 4,
      w,
      8,
      this.p2.cargaEspecialHUD,
      true,
    );
    this._pipsRounds(ctx, 36, y + h + 24, this.roundsP1, false);
    this._pipsRounds(ctx, LARGURA - 36, y + h + 24, this.roundsP2, true);
  }

  _desenharVS(ctx) {
    const vs = this.vs;
    if (!vs) return;
    const T = VS_TIMING;
    const total = T.entrada + T.confronto + T.round + T.flash;

    // 1) FUNDO ANIMADO — scroll seamless do estágio escolhido.
    this._desenharScrollVS(ctx, vs.scroll);
    // Escurece levemente para destacar lutadores e o "VS".
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // 2) LUTADORES deslizando das bordas (P1 esquerda, P2 direita), se encarando.
    const persP1 = PERSONAGENS[this.escolha.p1];
    const persP2 = PERSONAGENS[this.escolha.p2];
    this._desenharLutadorVS(ctx, persP1, vs.p1x, 1);
    this._desenharLutadorVS(ctx, persP2, vs.p2x, -1);

    // Nomes abaixo de cada sprite (fonte arcade/maiúsculas).
    ctx.textAlign = "center";
    ctx.font = "bold 18px 'Segoe UI', monospace";
    ctx.fillStyle = "#5cd6ff";
    ctx.fillText(this.p1.nome.toUpperCase(), vs.p1x, ALTURA - 18);
    ctx.fillText(
      this.p2.nome.toUpperCase() + (this.modo === "1p" ? " (CPU)" : ""),
      vs.p2x,
      ALTURA - 18,
    );

    // 3) HUD topo (barras + pips) para criar antecipação.
    this._desenharHUDVS(ctx);

    // 4) ELEMENTO "VS" central com entrada dramática (escala + flash).
    let escalaVS = 1;
    let flashVS = 0;
    if (vs.t < T.entrada) {
      const k = vs.t / T.entrada; // 0→1 durante a entrada
      escalaVS = 2.6 - 1.6 * (1 - Math.pow(1 - k, 2)); // grande → 1 (ease-out)
      flashVS = 1 - k; // clarão que some
    } else {
      escalaVS = 1 + 0.06 * Math.sin(performance.now() / 170); // pulso sutil
    }
    ctx.save();
    ctx.translate(LARGURA / 2, ALTURA / 2);
    ctx.scale(escalaVS, escalaVS);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#1a0a14";
    ctx.font = "900 120px 'Segoe UI', monospace";
    ctx.strokeText("VS", 0, 0);
    ctx.fillStyle = "#e03020";
    ctx.fillText("VS", 0, 0);
    if (flashVS > 0) {
      ctx.globalAlpha = flashVS;
      ctx.fillStyle = "#ffffff";
      ctx.fillText("VS", 0, 0);
    }
    ctx.restore();
    ctx.textBaseline = "alphabetic";

    // 5) "ROUND N" com zoom-in a partir dos 2s (fim do confronto).
    const inicioRound = T.entrada + T.confronto;
    if (vs.t >= inicioRound) {
      const tr = vs.t - inicioRound;
      const k = Math.min(1, tr / 0.3); // zoom-in nos primeiros 0.3s
      const escR = 3 - 2 * (1 - Math.pow(1 - k, 3)); // 3 → 1
      ctx.save();
      ctx.translate(LARGURA / 2, 150);
      ctx.scale(escR, escR);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd34d";
      ctx.font = "bold 46px 'Segoe UI', monospace";
      ctx.fillText("ROUND " + this.roundAtual, 0, 0);
      ctx.restore();
    }

    if (this.crt) this._scanlines(ctx);

    // 6) FLASH BRANCO final (ref. SF2): 2–3 frames antes de revelar o estágio.
    if (vs.t >= total - T.flash) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }
  }
}
