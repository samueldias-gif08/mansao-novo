"use strict";

// Mapa de teclas por SLOT (usa event.code, independente de layout).
// Slot != personagem: o slot define as teclas; o personagem define o sprite.
const TECLAS = {
  p1: {
    esquerda: "KeyA",
    direita: "KeyD",
    pula: "KeyW",
    agacha: "KeyS",
    soco: "KeyF",
    chute: "KeyG",
    projetil: "KeyH",
    agarra: "KeyC",
    especial: "KeyV",
    defende: "KeyR",
    provoca: "KeyT",
  },
  p2: {
    esquerda: "ArrowLeft",
    direita: "ArrowRight",
    pula: "ArrowUp",
    agacha: "ArrowDown",
    soco: "KeyJ",
    chute: "KeyK",
    projetil: "KeyL",
    agarra: "KeyN",
    especial: "KeyM",
    defende: "KeyP",
    provoca: "KeyY",
  },
};

// Lista de personagens (chaves de sprite no manifest) para a seleção.
const PERSONAGENS = ["p1", "p2", "p3", "serena", "android67", "belyx", "alessander", "carter", "greeg", "morgana"];

/* ===========================================================================
   FICHA DE APRESENTAÇÃO DOS LUTADORES — (1) MÓDULO DE DADOS da seleção.
   Metadados puramente cosméticos da tela SELECT (não afetam o balanceamento):
   cidade, estilo, frase de lore, barras de atributo (0–5), dificuldade (1–5) e
   o "estágio de origem" (arquivo do mapa exibido ao fundo do preview).

   >>> EDITE A FICHA NO manifest.json <<< (players.<p>.ficha). O objeto abaixo é
   só o DEFAULT: cada campo ausente no manifest cai aqui, então a tela nunca
   quebra por dado faltando (mesmo padrão de montarGolpes()). Recursos.ficha()
   mescla o manifest sobre estes valores. */
const FICHA_PADRAO = {
  cidade: "ORIGEM DESCONHECIDA",
  estilo: "ESTILO LIVRE",
  lore: ["Um lutador de história ainda não contada."],
  atributos: { forca: 3, velocidade: 3, defesa: 3, especial: 3 },
  dificuldade: 3,
  estagio: null,
};

// Cores da seleção de lutadores.
const SELECT_TEMA = {
  p1: { cor: "#ff4f64", forte: "#711a2e", brilho: "#ffacb8" },
  p2: { cor: "#59adff", forte: "#16467e", brilho: "#a6ddff" },
  ouro: "#eccc8c",
};

const SELECT_CELULAS = [
  ...PERSONAGENS.map((pers) => ({ tipo: "pers", pers })),
  { tipo: "random" },
];
const SELECT_COLS = Math.min(11, SELECT_CELULAS.length);
const SELECT_LINHAS = Math.ceil(SELECT_CELULAS.length / SELECT_COLS);
const TEMPO_SELECT = 30; // segundos até o auto-confirm ("insira ficha")

function retanguloCelulaSelect(indice) {
  const linha = Math.floor(indice / SELECT_COLS);
  const quantidade = Math.min(SELECT_COLS, SELECT_CELULAS.length - linha * SELECT_COLS);
  const gap = SELECT_LINHAS === 1 ? 6 : 5;
  const h = Math.min(91, Math.floor((95 - gap * (SELECT_LINHAS - 1)) / SELECT_LINHAS));
  const w = Math.min(h, Math.floor((LARGURA - 32 - gap * (SELECT_COLS - 1)) / SELECT_COLS));
  const largura = quantidade * w + (quantidade - 1) * gap;
  return { x: (LARGURA - largura) / 2 + (indice % SELECT_COLS) * (w + gap), y: 416 + linha * (h + gap), w, h };
}

// Estados possíveis da máquina de estados (um por vez).
const ESTADOS = {
  IDLE: "idle",
  WALK: "walk",
  JUMP: "jump",
  LAND: "land",
  ENTRY: "entry",
  DEFEAT: "defeat",
  CROUCH: "crouch",
  PUNCH: "punch",
  KICK: "kick",
  FIREBALL: "fireball",
  BLOCK: "block",
  GRAB: "grab",
  SPECIAL: "special",
  HIT: "hit",
  KNOCKDOWN: "knockdown",
  GETUP: "getup",
  KO: "ko",
  VICTORY: "victory",
  TAUNT: "taunt",
  FLIGHT: "flight",
  TELEPORT: "teleport",
  SHADOW_GUARD: "shadow_guard",
  CAPTURED: "captured",
  SHELL_GUARD: "shell_guard",
  SHELL_EXIT: "shell_exit",
  LIGHTNING: "lightning",
  // Defesa de agarrão: ambos cancelam o agarrão simultâneo e ficam presos
  // brevemente nesta pose antes de voltar ao neutro. NÃO é estado livre (input
  // não o sobrescreve) NEM estado de golpe (sem hitbox/janela de cancelamento).
  THROW_TECH: "throw_tech",
  // Especial defensivo do P2: recuo rápido evasivo (ESPECIAL + TRÁS). Como o
  // THROW_TECH, é um estado TRAVADO: não é livre (o input não o interrompe) nem
  // de golpe (sem hitbox). Volta ao neutro sozinho ao fim da distância/duração.
  BACKDASH: "backdash",
  // Especial ofensivo do P1: investida rápida para FRENTE (ESPECIAL + FRENTE).
  // Espelha o BACKDASH (estado travado, sem hitbox próprio), mas avança contra o
  // oponente. Encerra sozinho ao percorrer a distância/duração configurada.
  DASH: "dash",
};

// Estados "livres": a cada quadro são re-derivados a partir do input.
const ESTADOS_LIVRES = new Set([
  ESTADOS.IDLE,
  ESTADOS.WALK,
  ESTADOS.CROUCH,
  ESTADOS.BLOCK,
  ESTADOS.JUMP,
]);
// Estados de golpe (podem abrir janela de cancelamento ao acertar).
const ESTADOS_GOLPE = new Set([
  ESTADOS.PUNCH,
  ESTADOS.KICK,
  ESTADOS.GRAB,
  ESTADOS.SPECIAL,
  ESTADOS.FIREBALL,
]);

