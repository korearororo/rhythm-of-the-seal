/* Phaser를 CDN으로만 불러오는, 설치 없는 전투 프로토타입입니다. */
const WIDTH = 900;
const HEIGHT = 620;
const UI_FONT = '"Pretendard", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

// 외부 음원 없이 짧은 합성 효과음만 재생한다. 자동 재생 제한·미지원 환경은 조용히 무시한다.
class AudioDirector {
  constructor() {
    this.context = null;
    this.muted = false;
    this.activeSources = new Set();
  }

  activate() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch (_) {
      // 보안 정책 또는 기기 문제로 컨텍스트 생성에 실패해도 게임은 무음으로 계속한다.
    }
  }

  toggle() {
    this.muted = !this.muted;
    if (this.muted) this.stopAll();
    if (!this.muted) this.activate();
    return this.muted;
  }

  tone(frequency, duration = .08, type = 'square', volume = .028, delay = 0, slideTo = null) {
    const context = this.context;
    if (this.muted || !context || context.state !== 'running') return;
    try {
      const start = context.currentTime + delay;
      const end = start + duration;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), end);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(.012, duration / 3));
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      oscillator.connect(gain).connect(context.destination);
      this.activeSources.add(oscillator);
      oscillator.onended = () => this.activeSources.delete(oscillator);
      oscillator.start(start);
      oscillator.stop(end + .015);
    } catch (_) {
      // 브라우저가 오디오 노드 생성을 막아도 전투 입력과 상태 갱신은 계속한다.
    }
  }

  play(name) {
    const sounds = {
      button: () => this.tone(520, .045, 'square', .018, 0, 640),
      attack: () => { this.tone(180, .07, 'sawtooth', .025, 0, 480); this.tone(740, .045, 'square', .016, .035, 520); },
      enemyAttack: () => this.tone(150, .09, 'sawtooth', .024, 0, 85),
      hit: () => this.tone(105, .075, 'square', .022, 0, 65),
      defend: () => { this.tone(430, .07, 'triangle', .024); this.tone(640, .06, 'triangle', .018, .055); },
      focus: () => { this.tone(330, .06, 'sine', .018); this.tone(495, .09, 'sine', .017, .06); },
      rhythm: () => { this.tone(660, .045, 'triangle', .02); this.tone(880, .065, 'triangle', .018, .06); },
      charge: () => { this.tone(170, .13, 'sawtooth', .02, 0, 300); this.tone(250, .1, 'sawtooth', .014, .08, 410); },
      heavy: () => { this.tone(92, .17, 'sawtooth', .03, 0, 54); this.tone(55, .12, 'square', .018, .07); },
      interrupt: () => { this.tone(780, .07, 'square', .026); this.tone(1170, .12, 'triangle', .021, .06); },
      finisher: () => { this.tone(220, .1, 'sawtooth', .025, 0, 930); this.tone(880, .13, 'square', .03, .07, 1320); this.tone(1320, .16, 'triangle', .022, .15); },
      seal: () => { this.tone(610, .09, 'sine', .022); this.tone(915, .13, 'triangle', .02, .07); },
      phase: () => { this.tone(260, .14, 'sawtooth', .022, 0, 510); this.tone(1020, .15, 'triangle', .022, .1, 1320); },
      victory: () => { this.tone(523, .08, 'triangle', .022); this.tone(659, .1, 'triangle', .022, .09); this.tone(784, .18, 'triangle', .024, .2); },
    };
    if (sounds[name]) sounds[name]();
  }

  stopAll() {
    this.activeSources.forEach((source) => {
      try { source.stop(); } catch (_) { /* 이미 종료된 노드 */ }
    });
    this.activeSources.clear();
  }
}

const audio = new AudioDirector();

const ENEMY_INTENT_DEFS = {
  attack: { key: 'attack', name: '일반 공격', detail: '단검을 휘두릅니다.', damage: 5 },
  defend: { key: 'defend', name: '방어', detail: '방패를 들어 피해를 줄입니다.' },
  charge: { key: 'charge', name: '힘 모으기', detail: '다음 턴 강공격을 준비합니다.' },
  heavy: { key: 'heavy', name: '강공격', detail: '거칠게 내려찍습니다!', damage: 10 },
};

// 첫 플레이의 일반전 연속 생존 여유. 보스 전은 아래 전환 규칙에서 항상 완전 회복한다.
const GENERAL_BATTLE_HEAL = 15;

// 다음 세션에서 새 적을 추가할 때는 ENEMY_PRESETS에 새 객체만 추가하면 됩니다.
// 필요한 항목: 로그명/표시명, 최대 HP, 행동 예고 순서, 스프라이트.
const ENEMY_PRESETS = {
  goblin: {
    id: 'goblin',
    displayName: '고블린 정찰병',
    logName: '고블린 정찰병',
    maxHp: 40,
    // 원본 고블린은 왼쪽을 향한다. 오른쪽에 배치하므로 뒤집지 않아야 기사와 마주 본다.
    sprite: { texture: 'goblin-combat-sheet', frame: 'idle-0', x: 520, y: 286, scale: 164, flipX: false },
    combatSheet: true, combatAnimKey: 'goblin',
    // 튜토리얼은 화면에 순서를 노출하지 않는 공격→방어 고정 반복이다.
    intentSequence: ['attack', 'defend'],
    encounterLabel: '고블린 정찰병과 조우했다',
  },
  skeleton: {
    id: 'skeleton',
    displayName: '해골 성소지기',
    logName: '해골 성소지기',
    maxHp: 48,
    sprite: { texture: 'skeleton-combat-sheet', frame: 'idle-0', x: 520, y: 286, scale: 164, flipX: false },
    combatSheet: true, combatAnimKey: 'skeleton',
    intentSequence: ['attack', 'attack', 'defend'],
    encounterLabel: '해골 성소지기와 조우했다',
  },
  kobold: {
    id: 'kobold',
    displayName: '코볼트 주술사',
    logName: '코볼트 주술사',
    maxHp: 52,
    sprite: { texture: 'kobold-shaman-combat-sheet', frame: 'idle-0', x: 520, y: 286, scale: 164, flipX: false },
    combatSheet: true, combatAnimKey: 'kobold',
    // 세 번째 성공한 힘 모으기 뒤의 공격 칸만 강공격으로 바뀐다.
    intentSequence: ['defend', 'charge', 'attack'],
    encounterLabel: '코볼트 주술사가 룬 지팡이를 들어 올린다',
  },
  orc: {
    id: 'orc',
    displayName: '오크 파수꾼',
    logName: '오크 파수꾼',
    maxHp: 56,
    sprite: { texture: 'orc-sentinel-combat-sheet', frame: 'idle-0', x: 520, y: 286, scale: 178, flipX: false },
    combatSheet: true, combatAnimKey: 'orc',
    // 공격 칸은 적 리듬이 3일 때만 강공격으로 바뀐다.
    intentSequence: ['attack', 'defend', 'attack', 'charge'],
    encounterLabel: '오크 파수꾼이 방패 뒤에서 도끼를 고쳐 쥔다',
  },
  arbiter: {
    id: 'arbiter',
    displayName: '봉인 심판관',
    logName: '봉인 심판관',
    maxHp: 64,
    sprite: { texture: 'seal-arbiter-combat-sheet', frame: 'idle-0', x: 520, y: 286, scale: 210, flipX: false },
    combatSheet: true, combatAnimKey: 'arbiter',
    // 보스는 intentSequence 순환을 쓰지 않는다. 묶음은 BattleScene이 HP·플레이어 리듬에서 선택한다.
    intentSequence: ['defend', 'attack', 'charge'],
    encounterLabel: '심장석의 마지막 수호자 · 봉인 심판관',
    boss: { phaseThreshold: 32, attackDamage: [6, 7], heavyDamage: 12, exposedFinisherDamage: 24 },
  },
};

const ENEMY_ORDER = ['goblin', 'skeleton', 'kobold', 'orc', 'arbiter'];

// 전투 규칙과 분리한 진행용 문구다. 다음 적의 정체와 구역만 전환 화면에서 알려 준다.
const DUNGEON_FLOW = {
  goblin: { zone: '성소 입구 · 1/5', threat: '흔들리는 봉인을 지키는 정찰병이 길을 막는다.' },
  skeleton: { zone: '무너진 회랑 · 2/5', threat: '성소지기의 연속 검격이 통로를 지킨다.' },
  kobold: { zone: '룬 저장고 · 3/5', threat: '룬 지팡이가 힘을 모아 다음 타격을 노린다.' },
  orc: { zone: '봉인문 앞 · 4/5', threat: '파수꾼은 긴 호흡으로 강한 일격의 자리를 숨긴다.' },
  arbiter: { zone: '봉인실 전실 · 최종전', threat: '심장석의 마지막 수호자가 봉인문 너머에서 기다린다.' },
};

function pixelSprite(scene, x, y, texture, frame, height, alpha = 1) {
  const sprite = scene.add.image(x, y, texture, frame).setAlpha(alpha);
  return sprite.setScale(height / sprite.height);
}

// 입구와 엔딩의 바닥은 끊어진 소품 목록 대신 하나의 석조 단으로 연결한다.
function shrineLanding(scene, top) {
  const stone = scene.add.graphics();
  stone.fillStyle(0x292038).fillRect(80, top, 740, 96);
  stone.fillStyle(0x443049).fillRect(80, top, 740, 4);
  stone.fillStyle(0x151121).fillRect(80, top + 92, 740, 4);
  stone.fillStyle(0x1c1629).fillRect(80, top + 42, 740, 2);
  for (const x of [200, 360, 540, 700]) stone.fillRect(x, top + 4, 2, 38);
  for (const x of [130, 280, 450, 620, 770]) stone.fillRect(x, top + 44, 2, 48);
  return stone;
}

function validateEnemyPresets() {
  const issues = [];
  if (!Array.isArray(ENEMY_ORDER) || ENEMY_ORDER.length === 0) {
    issues.push('ENEMY_ORDER가 비어 있거나 배열이 아닙니다.');
  }

  for (const enemyId of ENEMY_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(ENEMY_PRESETS, enemyId)) {
      issues.push(`ENEMY_ORDER에 '${enemyId}'가 포함되었지만 ENEMY_PRESETS에 정의되지 않았습니다.`);
    }
  }

  Object.entries(ENEMY_PRESETS).forEach(([presetId, enemy]) => {
    if (!enemy.id || typeof enemy.id !== 'string') issues.push(`${presetId}: id가 없거나 문자열이 아닙니다.`);
    if (!enemy.displayName || typeof enemy.displayName !== 'string') issues.push(`${presetId}: displayName이 없거나 문자열이 아닙니다.`);
    if (!enemy.logName || typeof enemy.logName !== 'string') issues.push(`${presetId}: logName이 없거나 문자열이 아닙니다.`);
    if (typeof enemy.maxHp !== 'number' || !Number.isFinite(enemy.maxHp) || enemy.maxHp <= 0) issues.push(`${presetId}: maxHp가 0보다 큰 숫자가 아닙니다.`);

    if (!enemy.sprite || typeof enemy.sprite !== 'object') {
      issues.push(`${presetId}: sprite 객체가 없습니다.`);
    } else {
      if (!enemy.sprite.texture || typeof enemy.sprite.texture !== 'string') issues.push(`${presetId}: sprite.texture가 없습니다.`);
      if (!enemy.sprite.frame || typeof enemy.sprite.frame !== 'string') issues.push(`${presetId}: sprite.frame이 없습니다.`);
      ['x', 'y', 'scale'].forEach((axis) => {
        const value = enemy.sprite[axis];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          issues.push(`${presetId}: sprite.${axis}가 숫자가 아닙니다.`);
        }
      });
    }

    if (!Array.isArray(enemy.intentSequence) || enemy.intentSequence.length === 0) {
      issues.push(`${presetId}: intentSequence가 비어 있거나 배열이 아닙니다.`);
    } else {
      enemy.intentSequence.forEach((intentKey) => {
        if (!ENEMY_INTENT_DEFS[intentKey]) {
          issues.push(`${presetId}: intentSequence의 '${intentKey}'가 ENEMY_INTENT_DEFS에 없습니다.`);
        }
      });
    }
  });

  if (issues.length > 0) {
    throw new Error(`[ENEMY_PRESETS 검증 실패]\n${issues.join('\n')}`);
  }
}

class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  preload() {
    this.load.json('combat-atlas-layout', 'assets/combat-atlas-layout.json');
    this.load.json('combat-row-corrections', 'assets/combat-row-corrections.json');
    this.load.image('combat-pose-corrections', 'assets/combat-pose-corrections.png');
    this.load.image('combat-heavy-corrections', 'assets/combat-heavy-corrections.png');
    this.load.image('shrine-kit', 'assets/shrine-kit.png');
    this.load.image('characters', 'assets/characters.png');
    this.load.image('skeleton-shrine-keeper', 'assets/skeleton-shrine-keeper.png');
    this.load.image('seal-arbiter', 'assets/seal-arbiter.png');
    this.load.image('seal-arbiter-combat-sheet', 'assets/seal-arbiter-combat-sheet.png');
    this.load.image('seal-arbiter-arena', 'assets/seal-arbiter-arena.png');
    this.load.image('combat-effects', 'assets/combat-effects.png');
    this.load.image('novice-combat-sheet', 'assets/novice-combat-sheet.png');
    this.load.image('skeleton-combat-sheet', 'assets/skeleton-shrine-keeper-combat-sheet.png');
    this.load.image('goblin-combat-sheet', 'assets/goblin-combat-sheet.png');
    this.load.image('kobold-shaman-combat-sheet', 'assets/kobold-shaman-combat-sheet.png');
    this.load.image('orc-sentinel-combat-sheet', 'assets/orc-sentinel-combat-sheet.png');
  }

  create() {
    validateEnemyPresets();
    prepareCombatArt(this);

    const shrine = this.textures.get('shrine-kit');
    shrine.add('arch', 0, 0, 0, 680, 770);
    shrine.add('pillar-left', 0, 680, 60, 230, 690);
    shrine.add('pillar-right', 0, 910, 80, 250, 680);
    shrine.add('rune', 0, 1140, 320, 396, 440);
    shrine.add('floor-strip', 0, 0, 760, 1536, 264);

    const characters = this.textures.get('characters');
    characters.add('novice', 0, 20, 20, 760, 820);
    characters.add('goblin', 0, 990, 70, 784, 817);

    const skeleton = this.textures.get('skeleton-shrine-keeper');
    skeleton.add('idle', 0, 0, 0, 1312, 1199);

    const sealArbiter = this.textures.get('seal-arbiter');
    sealArbiter.add('idle', 0, 0, 0, 1312, 1199);

    const effects = this.textures.get('combat-effects');
    effects.add('attack', 0, 0, 0, 724, 724);
    effects.add('guard', 0, 724, 0, 724, 724);
    effects.add('rhythm', 0, 1448, 0, 724, 724);

    const noviceCombat = this.textures.get('novice-combat-sheet');
    ['idle', 'attack', 'guard', 'focus', 'hurt', 'heavy', 'down'].forEach((row, rowIndex) => {
      for (let column = 0; column < 4; column++) {
        noviceCombat.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
      }
      this.anims.create({
        key: `novice-${row}`,
        // 다운은 무릎 자세의 작은 호흡만 반복한다.
        frames: combatFrames('novice-combat-sheet', row),
        frameRate: row === 'down' ? 3 : (row === 'attack' || row === 'hurt' ? 12 : 9),
        repeat: row === 'idle' || row === 'down' ? -1 : 0,
      });
    });
    const goblinCombat = this.textures.get('goblin-combat-sheet');
    ['idle', 'attack', 'guard', 'hurt', 'parry', 'down'].forEach((row, rowIndex) => {
      for (let column = 0; column < 4; column++) goblinCombat.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
      this.anims.create({ key: `goblin-${row}`, frames: combatFrames('goblin-combat-sheet', row), frameRate: row === 'down' ? 3 : (row === 'attack' || row === 'hurt' ? 12 : 9), repeat: row === 'idle' || row === 'down' ? -1 : 0 });
    });
    const skeletonCombat = this.textures.get('skeleton-combat-sheet');
    ['idle', 'attack', 'guard', 'hurt', 'parry', 'down'].forEach((row, rowIndex) => {
      for (let column = 0; column < 4; column++) skeletonCombat.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
      this.anims.create({
        key: `skeleton-${row}`,
        frames: combatFrames('skeleton-combat-sheet', row),
        frameRate: row === 'down' ? 3 : (row === 'attack' || row === 'hurt' ? 12 : 9),
        repeat: row === 'idle' || row === 'down' ? -1 : 0,
      });
    });
    [['kobold', 'kobold-shaman-combat-sheet'], ['orc', 'orc-sentinel-combat-sheet']].forEach(([enemyId, textureKey]) => {
      const combatTexture = this.textures.get(textureKey);
      ['idle', 'attack', 'guard', 'charge', 'hurt', 'heavy', 'parry', 'down'].forEach((row, rowIndex) => {
        // 오크는 방패가 유지되는 작은 도끼질을 일반 공격, 새 큰 궤적을 강공격으로 쓴다.
        const sourceRow = enemyId === 'orc' ? (row === 'attack' ? 5 : row === 'heavy' ? 1 : rowIndex) : rowIndex;
        for (let column = 0; column < 4; column++) combatTexture.add(`${row}-${column}`, 0, column * 280, sourceRow * 280, 280, 280);
        this.anims.create({
          key: `${enemyId}-${row}`,
          frames: combatFrames(textureKey, row),
          frameRate: row === 'down' ? 3 : (row === 'attack' || row === 'hurt' || row === 'heavy' ? 12 : 9),
          repeat: row === 'idle' || row === 'down' ? -1 : 0,
        });
      });
    });
    const arbiterCombat = this.textures.get('seal-arbiter-combat-sheet');
    ['idle', 'attack', 'guard', 'charge', 'heavy', 'hurt', 'down'].forEach((row, rowIndex) => {
      for (let column = 0; column < 4; column++) arbiterCombat.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
      this.anims.create({
        key: `arbiter-${row}`,
        frames: combatFrames('seal-arbiter-combat-sheet', row),
        frameRate: row === 'down' ? 3 : (row === 'attack' || row === 'hurt' || row === 'heavy' ? 12 : 9),
        repeat: row === 'idle' || row === 'down' ? -1 : 0,
      });
    });
    // 시각 QA 전용 바로가기: 전투 규칙을 건드리지 않고 정상 보스 초기 상태로만 진입한다.
    // qaPose는 포즈를 반복 표시하고 qaOutcome은 기존 결과 화면만 즉시 재현한다.
    const qaParams = new URLSearchParams(window.location.search);
    // 채팅/문서에서 URL을 복사할 때 `&amp;`가 실제 주소에 남아도 QA 경로가 idle로
    // 조용히 떨어지지 않게, 표준 키와 엔티티가 남은 키를 함께 읽는다.
    const qaParam = (name) => qaParams.get(name) || qaParams.get(`amp;${name}`);
    const qaBoss = qaParams.get('qa') === 'boss';
    const qaPoseValue = qaParam('qaPose');
    const qaOutcomeValue = qaParam('qaOutcome');
    const qaPose = ['heavy', 'hurt'].includes(qaPoseValue) ? qaPoseValue : null;
    const qaOutcome = ['lose', 'win'].includes(qaOutcomeValue) ? qaOutcomeValue : null;
    if (qaBoss) {
      this.registry.set('battleOrder', ENEMY_ORDER);
      this.registry.set('battleIndex', ENEMY_ORDER.indexOf('arbiter'));
      this.registry.set('carriedPlayerHp', null);
      this.registry.set('bossQaHook', qaOutcome ? { outcome: qaOutcome } : (qaPose ? { pose: qaPose } : null));
      this.scene.start('battle');
    } else {
      this.registry.set('bossQaHook', null);
      this.scene.start('intro');
    }
  }
}

class IntroScene extends Phaser.Scene {
  constructor() { super('intro'); }

  create() {
    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x171024);
    pixelSprite(this, WIDTH / 2, 287, 'shrine-kit', 'arch', 450, .46);
    shrineLanding(this, 462);
    this.add.sprite(196, 404, 'novice-combat-sheet', 'idle-0').setScale(164 / 280).play('novice-idle');
    pixelSprite(this, 704, 400, 'shrine-kit', 'rune', 108, .8);
    this.add.text(WIDTH / 2, 82, '봉인의 박자', { fontFamily: UI_FONT, fontSize: '36px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 142, '성소 입구', { fontFamily: UI_FONT, fontSize: '19px', fontStyle: 'bold', color: '#f8f1ff' }).setOrigin(.5);
    this.add.rectangle(450, 264, 740, 154, 0x171024, .94).setStrokeStyle(1, 0x776344);
    this.add.text(450, 217, '성소 깊은 곳에서 심장석을 되찾으세요.', { fontFamily: UI_FONT, fontSize: '19px', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(450, 261, '공격으로 힘 모으기를 끊고, 방어로 피해를 줄입니다.', { fontFamily: UI_FONT, fontSize: '16px', color: '#c6b6d8' }).setOrigin(.5);
    this.add.text(450, 298, '빈틈에 집중하세요. 리듬 3칸이면 강공격을 쓸 수 있습니다.', { fontFamily: UI_FONT, fontSize: '16px', color: '#c6b6d8' }).setOrigin(.5);
    this.makeButton('첫 전투 시작', 450, 514, 220, 50, 0x765199, () => {
      this.registry.set('battleOrder', ENEMY_ORDER);
      this.registry.set('battleIndex', 0);
      this.registry.set('carriedPlayerHp', null);
      this.scene.start('battle');
    });
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(1, 0xb3a384);
    const text = this.add.text(0, 0, label, { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0x786747));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', () => { audio.activate(); audio.play('button'); callback(); });
  }
}

class BattleScene extends Phaser.Scene {
  constructor() { super('battle'); }

  create() {
    this.battleOrder = this.registry.get('battleOrder') || ENEMY_ORDER;
    const battleIndex = this.registry.get('battleIndex') || 0;
    const enemyKey = this.battleOrder[battleIndex] || ENEMY_ORDER[0];
    this.enemyConfig = ENEMY_PRESETS[enemyKey] || ENEMY_PRESETS.goblin;
    this.enemyIndex = battleIndex;
    this.colors = { ink: 0x1a1224, panel: 0x2a1d3b, border: 0x9d7bbf, gold: 0xffd56a, hp: 0xeb5b67, green: 0x79bf78, muted: 0xa99bb9, white: 0xf8f1ff };
    this.buildBackground();
    this.buildUi();
    this.resetBattle();
    // 장면 초기화가 끝난 뒤 훅을 적용해야 QA 승리의 기존 800ms 타이머가 안정적으로 시작된다.
    this.time.delayedCall(32, () => this.applyBossQaHook());
    this.events.once('shutdown', () => { this.clearVictoryTransition(); this.stopDownMotion(); this.stopEnemyDownMotion(); audio.stopAll(); });
  }

  applyBossQaHook() {
    const hook = this.registry.get('bossQaHook');
    if (!this.enemyConfig.boss || !hook) return;
    if (hook.pose) {
      // 한 번 재생 후 idle로 돌아가는 일반 포즈와 달리, QA 화면에서는 관찰할 수 있게 반복한다.
      this.enemyFigure.play({ key: `${this.enemyConfig.combatAnimKey}-${hook.pose}`, repeat: -1 }, true);
      return;
    }
    // 결과 재현은 이 장면을 열 때 한 번만 적용한다. 다시 시작과 이후 정상 전투는 기존 초기화 경로를 쓴다.
    this.registry.set('bossQaHook', null);
    if (hook.outcome === 'lose') {
      this.playerHp = 0;
      this.finish(false, 'QA: 패배 후 다시 시작 화면 확인');
    } else if (hook.outcome === 'win') {
      this.enemyHp = 0;
      this.finish(true, 'QA: 승리 엔딩 전환 확인');
    }
  }

  update() {
    if (this.playerFigure?.active) this.playerShadow?.setX(this.playerFigure.x);
    if (this.enemyFigure?.active) this.enemyShadow?.setX(this.enemyFigure.x);
  }

  text(x, y, value, size = 14, color = '#f8f1ff', align = 'left') {
    return this.add.text(x, y, value, { fontFamily: UI_FONT, fontSize: `${size}px`, fontStyle: 'bold', color, align, lineSpacing: 6 }).setOrigin(align === 'center' ? .5 : 0, 0);
  }

  panel(x, y, w, h) { return this.add.rectangle(x, y, w, h, this.colors.panel).setStrokeStyle(1, this.colors.border); }

  isTutorial() { return this.enemyConfig.id === 'goblin'; }

  isPatternEnemy() { return !this.enemyConfig.boss; }

  setPlayerPose(pose, hold = false) {
    if (!this.playerFigure?.active) return;
    this.cancelStrikeMotion('player');
    // 수습 기사 전투 시트 원본은 오른쪽을 향한다. 모든 포즈 전환 뒤에도
    // 좌측 기사는 원본 방향 그대로 오른쪽의 적을 바라본다.
    this.playerFigure.setFlipX(false);
    if (pose === 'down') this.startDownMotion();
    else this.stopDownMotion();
    this.playerFigure.play(`novice-${pose}`, true).setFlipX(false);
    if (!hold && pose !== 'idle') {
      this.playerFigure.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (!this.over && !this.isDown()) this.playerFigure.play('novice-idle', true).setFlipX(false);
      });
    }
  }

  startDownMotion() {
    if (this.downMotion || !this.playerFigure?.active) return;
    this.downRestingY = this.playerFigure.y;
    this.downMotion = this.tweens.add({
      targets: this.playerFigure,
      y: this.downRestingY + 3,
      angle: -2,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  stopDownMotion() {
    if (!this.downMotion) return;
    this.downMotion.stop();
    this.downMotion = null;
    if (this.playerFigure?.active) this.playerFigure.setY(this.downRestingY ?? this.playerFigure.y).setAngle(0);
    this.downRestingY = null;
  }

  setEnemyPose(pose, hold = false) {
    if (!this.enemyConfig.combatSheet || !this.enemyFigure?.active) return;
    const prefix = this.enemyConfig.combatAnimKey;
    if (!this.anims.exists(`${prefix}-${pose}`)) return;
    this.cancelStrikeMotion('enemy');
    if (pose === 'down') this.startEnemyDownMotion();
    else this.stopEnemyDownMotion();
    this.enemyFigure.play(`${prefix}-${pose}`, true);
    if (!hold && pose !== 'idle') {
      this.enemyFigure.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (!this.over && this.enemyFigure?.active) this.enemyFigure.play(`${prefix}-idle`, true);
      });
    }
  }

  isDown() { return this.downTurns > 0; }

  clearResolutionTimers() {
    (this.resolutionTimers || []).forEach(timer => timer.remove(false));
    this.resolutionTimers = [];
  }

  scheduleResolution(delay, callback) {
    const timer = this.time.delayedCall(delay, () => {
      this.resolutionTimers = this.resolutionTimers.filter(item => item !== timer);
      callback();
    });
    this.resolutionTimers.push(timer);
    return timer;
  }

  buildBackground() {
    this.cameras.main.setBackgroundColor('#171024');
    if (this.enemyConfig.boss) {
      this.add.image(WIDTH / 2, HEIGHT / 2 - 60, 'seal-arbiter-arena').setDisplaySize(WIDTH, HEIGHT);
    } else {
      this.add.rectangle(WIDTH / 2, 374, WIDTH, 235, 0x21172e);
      pixelSprite(this, WIDTH / 2, 228, 'shrine-kit', 'arch', 390, .25);
      pixelSprite(this, WIDTH / 2, 414, 'shrine-kit', 'floor-strip', 180, .55);
      pixelSprite(this, WIDTH / 2, 304, 'shrine-kit', 'rune', 132, .34);
    }
    this.add.rectangle(450, 30, 900, 60, 0x100d18, .88);
    this.add.rectangle(450, 448, 900, 344, 0x100d18, .92);
    this.text(WIDTH / 2, 22, this.enemyConfig.encounterLabel, 18, '#ffd56a', 'center');
  }

  clearVictoryTransition() {
    if (this.victoryTimer) this.victoryTimer.remove(false);
    if (this.victoryFallbackTimer) window.clearTimeout(this.victoryFallbackTimer);
    this.victoryTimer = null;
    this.victoryFallbackTimer = null;
  }

  scheduleBossVictoryTransition() {
    // 기본 플레이와 QA 승리는 같은 EndingScene 경로를 쓴다. Phaser 장면 시간이
    // 비활성 탭에서 멈춰도 끝 화면에 갇히지 않게 브라우저 타이머를 한 번만 백업한다.
    this.clearVictoryTransition();
    this.victoryTransitionComplete = false;
    const advance = () => {
      if (this.victoryTransitionComplete || !this.scene.isActive()) return;
      this.victoryTransitionComplete = true;
      this.clearVictoryTransition();
      this.advanceAfterVictory();
    };
    this.victoryTimer = this.time.delayedCall(800, advance);
    this.victoryFallbackTimer = window.setTimeout(advance, 1000);
  }

  buildUi() {
    this.intentPanel = this.panel(450, 95, 600, 66); this.intentText = this.text(450, 70, '', 15, '#ffd56a', 'center'); this.intentDetail = this.text(450, 99, '', 12, '#c6b6d8', 'center');
    this.playerName = this.text(38, 290, '수습 기사', 16);
    this.enemyName = this.text(650, 290, '', 16);
    this.playerHpText = this.text(38, 315, '', 12); this.enemyHpText = this.text(650, 315, '', 12);
    this.playerBar = this.add.rectangle(138, 345, 200, 16, this.colors.hp).setStrokeStyle(2, 0xf8f1ff); this.enemyBar = this.add.rectangle(750, 345, 200, 16, this.colors.green).setStrokeStyle(2, 0xf8f1ff);
    this.hpBarTweens = { player: null, enemy: null };
    this.playerShadow = this.add.ellipse(380, 286, 76, 12, 0x050409, .6);
    this.enemyShadow = this.add.ellipse(520, 286, 88, 12, 0x050409, .6);
    // 전투 시트 원본은 오른쪽을 향한다. 좌측의 기사는 뒤집지 않고 오른쪽 적을 향한다.
    this.playerFigure = this.add.sprite(380, 225, 'novice-combat-sheet', 'idle-0').setScale(164 / 280).setFlipX(false).play('novice-idle').setFlipX(false);
    this.enemyFigure = null;
    this.sealText = this.text(750, 359, '', 11, '#ffd56a', 'center');
    this.phaseText = this.text(450, 170, '', 12, '#ffd56a', 'center');
    this.downText = this.text(145, 365, '', 11, '#ffad64', 'center');
    this.panel(450, 412, 820, 74); this.logText = this.text(450, 380, '', 14, '#f8f1ff', 'center').setWordWrapWidth(780);
    this.text(78, 465, '리듬', 14, '#ffd56a'); this.rhythmBoxes = [0,1,2].map(i => this.add.rectangle(142 + i * 34, 474, 24, 24, 0x362746).setStrokeStyle(2, this.colors.border));
    this.rhythmText = this.text(212, 465, '', 12, '#c6b6d8');
    this.buttons = {};
    this.buttons.attack = this.makeButton('attack', '공격', 330, 478, 128, 46, 0x703e46);
    this.buttons.defend = this.makeButton('defend', '방어', 470, 478, 128, 46, 0x39536c);
    this.buttons.focus = this.makeButton('focus', '집중', 610, 478, 128, 46, 0x4e6045);
    this.buttons.finisher = this.makeButton('finisher', '강공격', 760, 478, 140, 46, 0x786037);
    [['힘 모으기 차단', 330], ['피해 감소', 470], ['리듬 획득', 610], ['리듬 3칸 필요', 760]].forEach(([label, x]) => this.text(x, 512, label, 12, '#b4a8bd', 'center'));
    this.restartButton = this.makeButton('restart', '다시 시작', 450, 555, 160, 42, 0x765199);
    this.soundButton = this.makeSoundButton();
    this.restartButton.container.setVisible(false);
  }

  makeSoundButton() {
    const bg = this.add.rectangle(0, 0, 92, 28, 0x3b2b50).setStrokeStyle(2, 0xa98bc2);
    const label = this.text(0, -7, '', 11, '#f8f1ff', 'center').setOrigin(.5, .5);
    const container = this.add.container(842, 38, [bg, label]).setSize(92, 28).setInteractive({ useHandCursor: true });
    const refresh = () => {
      const muted = audio.muted;
      label.setText(muted ? '소리: 끔' : '소리: 켬').setColor(muted ? '#c6b6d8' : '#ffd56a');
      bg.setFillStyle(muted ? 0x362746 : 0x3b2b50);
    };
    container.on('pointerdown', () => { audio.activate(); audio.toggle(); refresh(); });
    container.on('pointerover', () => bg.setStrokeStyle(2, 0xffd56a));
    container.on('pointerout', () => bg.setStrokeStyle(2, 0xa98bc2));
    refresh();
    return {
      container,
      refresh,
      status: () => ({ muted: audio.muted, supported: !!(window.AudioContext || window.webkitAudioContext), activeSources: audio.activeSources.size }),
    };
  }

  makeButton(key, label, x, y, w, h, color) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(1, 0xb3a384);
    const labelText = this.text(0, 0, label, 15, '#ffffff', 'center').setOrigin(.5, .5);
    const container = this.add.container(x, y, [bg, labelText]).setSize(w, h).setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => {
      audio.activate();
      if (key === 'restart') { audio.play('button'); this.resetBattle(); }
      else if (!this.inputLocked) { audio.play('button'); this.takeTurn(key, true); }
    });
    container.on('pointerover', () => { if (container.input.enabled) bg.setFillStyle(0x786747); });
    container.on('pointerout', () => bg.setFillStyle(color));
    return { container, bg, color };
  }

  resetBattle() {
    this.cancelStrikeMotion('player');
    this.cancelStrikeMotion('enemy');
    audio.stopAll();
    this.clearVictoryTransition();
    if (this.actionUnlockTimer) this.actionUnlockTimer.remove(false);
    this.clearResolutionTimers();
    this.actionUnlockTimer = null;
    this.victoryTransitionComplete = false;
    this.inputLocked = false;
    this.resolutionPhase = 'idle';
    const enemy = this.enemyConfig;
    this.playerMaxHp = 34;
    const carriedPlayerHp = this.registry.get('carriedPlayerHp');
    this.playerHp = typeof carriedPlayerHp === 'number' ? Math.min(this.playerMaxHp, carriedPlayerHp) : this.playerMaxHp;
    this.registry.set('carriedPlayerHp', null);
    this.enemyHp = this.enemyMaxHp = enemy.maxHp;
    Object.values(this.hpBarTweens || {}).forEach(tween => tween?.stop());
    this.hpBarTweens = { player: null, enemy: null };
    this.intentQueue = enemy.intentSequence.map((intentKey) => ENEMY_INTENT_DEFS[intentKey]);
    this.enemyName.setText(enemy.displayName);
    this.stopEnemyDownMotion();
    if (this.enemyFigure) this.enemyFigure.destroy();
    const art = this.registry.get('combatArtAudit')?.[enemy.sprite.texture];
    this.enemyFigure = enemy.combatSheet
      ? this.add.sprite(enemy.sprite.x, enemy.sprite.y, enemy.sprite.texture, enemy.sprite.frame).setOrigin(art?.originX ?? .5, .9286).setScale((art?.display || enemy.sprite.scale) / 280).setFlipX(enemy.sprite.flipX).play(`${enemy.combatAnimKey}-idle`)
      : pixelSprite(this, enemy.sprite.x, enemy.sprite.y, enemy.sprite.texture, enemy.sprite.frame, enemy.sprite.scale).setFlipX(enemy.sprite.flipX);
    this.goblinBasePose = enemy.id === 'goblin'
      ? { x: this.enemyFigure.x, y: this.enemyFigure.y, scaleX: this.enemyFigure.scaleX, scaleY: this.enemyFigure.scaleY, angle: this.enemyFigure.angle }
      : null;
    this.rhythm = 0; this.enemyRhythm = 0; this.turn = 0; this.over = false;
    this.downTurns = 0;
    this.phase = 1; this.sealBroken = false; this.lastIntentKey = null;
    this.bossBundle = null; this.bossBundleIndex = 0; this.bossDown = false;
    if (enemy.boss) this.selectBossBundle();
    this.phaseText.setText('');
    if (this.sealRune) this.sealRune.destroy();
    this.sealRune = enemy.boss ? pixelSprite(this, 520, 200, 'shrine-kit', 'rune', 120, .5).setVisible(false) : null;
    this.restartButton.container.setVisible(false); Object.entries(this.buttons).forEach(([key, b]) => { if (key !== 'restart') b.container.setVisible(true); });
    this.setPlayerPose('idle', true);
    this.log = this.isTutorial() ? '고블린은 공격 → 방어를 반복한다. 첫 공격에 대비하자.' : '적의 동작을 기억하고 빈틈을 찾자.'; this.render(true);
  }

  currentIntent() {
    const boss = this.enemyConfig.boss;
    if (boss) return this.currentBossIntent();
    const intent = this.intentQueue[this.turn % this.intentQueue.length];
    // 일반 적의 고정 패턴에는 강공격 칸을 두지 않는다. 적 리듬 3일 때만
    // 다음 공격 칸을 강공격으로 대체하고, 실제 사용 뒤에는 0으로 비운다.
    if (intent.key === 'attack' && this.enemyRhythm === 3) {
      return { ...ENEMY_INTENT_DEFS.heavy, detail: '완성된 힘을 거칠게 내려찍습니다!' };
    }
    return intent;
  }

  selectBossBundle() {
    if (!this.enemyConfig.boss) return;
    const highRhythm = this.rhythm >= 2;
    const phaseTwo = this.enemyHp <= this.enemyConfig.boss.phaseThreshold;
    const keys = highRhythm
      ? (phaseTwo ? ['attack', 'charge', 'finisher'] : ['charge', 'finisher'])
      : ['defend', 'attack', 'charge', 'finisher'];
    this.bossBundle = keys;
    this.bossBundleIndex = 0;
  }

  currentBossIntent() {
    if (!this.bossBundle?.length) this.selectBossBundle();
    const slot = this.bossBundle[this.bossBundleIndex] || 'finisher';
    const baseKey = slot === 'finisher' ? 'attack' : slot;
    const isAttackSlot = baseKey === 'attack';
    const isHeavy = isAttackSlot && this.enemyRhythm === 3;
    const key = isHeavy ? 'heavy' : baseKey;
    const boss = this.enemyConfig.boss;
    const damage = key === 'attack' ? boss.attackDamage[this.phase - 1] : key === 'heavy' ? boss.heavyDamage : 0;
    return { ...ENEMY_INTENT_DEFS[key], damage, bossFinisher: slot === 'finisher', bossHeavyReplacement: isHeavy };
  }

  showFloatingText(x, y, value, color, emphatic = false) {
    const popup = this.text(x, y, value, emphatic ? 19 : 15, color, 'center').setDepth(20).setOrigin(.5);
    popup.setStroke('#171024', 4);
    this.tweens.add({ targets: popup, y: y - (emphatic ? 64 : 46), alpha: 0, scaleX: emphatic ? 1.25 : 1, scaleY: emphatic ? 1.25 : 1, duration: emphatic ? 1400 : 1100, ease: 'Cubic.Out', onComplete: () => popup.destroy() });
  }

  playEffect(frame, x, y, size = 104, emphatic = false, duration = emphatic ? 440 : 300, depth = 15) {
    const effect = pixelSprite(this, x, y, 'combat-effects', frame, size).setOrigin(.5).setDepth(depth).setAlpha(.92);
    const baseScale = effect.scaleX;
    this.tweens.add({ targets: effect, alpha: 0, scaleX: baseScale * (emphatic ? 1.45 : 1.25), scaleY: baseScale * (emphatic ? 1.45 : 1.25), duration, ease: 'Quad.Out', onComplete: () => effect.destroy() });
  }

  flashCombatant(side, color, emphatic = false, knockback = true) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    // 이전의 반투명 사각형은 프레임 위에 빨강/파랑 배경 잔상처럼 보였다.
    // 캐릭터 픽셀만 짧게 틴트해 피격·방어를 구분한다.
    figure.setTint(color);
    this.time.delayedCall(emphatic ? 280 : 180, () => {
      if (figure?.active) figure.clearTint();
    });
    if (knockback) this.tweens.add({ targets: figure, x: figure.x + (side === 'player' ? -1 : 1) * (emphatic ? 12 : 8), duration: 70, yoyo: true, hold: 80, ease: 'Cubic.Out' });
  }

  showGuard(side, emphatic = false) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    if (side === 'player' || this.enemyConfig.boss) {
      figure.anims.stop();
      figure.setFrame('guard-2');
    }
    figure.setTint(0x83d6ff);
    this.time.delayedCall(emphatic ? 520 : 440, () => {
      if (figure?.active) figure.clearTint();
    });
    const frontX = figure.x + (side === 'player' ? 40 : -36);
    const chestY = figure.y - (side === 'player' ? 8 : 58);
    this.playEffect('guard', frontX, chestY, emphatic ? 38 : 30, false, 260, 15);
    audio.play('defend');
  }

  animateGoblinGuard(impact = false) {
    if (this.enemyConfig.id !== 'goblin' || !this.enemyFigure?.active) return;
    const figure = this.enemyFigure;
    const base = this.goblinBasePose || { x: figure.x, y: figure.y, scaleX: figure.scaleX, scaleY: figure.scaleY, angle: 0 };
    this.tweens.killTweensOf(figure);
    if (!impact) {
      figure.setPosition(base.x, base.y).setScale(base.scaleX, base.scaleY).setAngle(0);
      this.tweens.add({ targets: figure, x: base.x - 13, y: base.y + 3, angle: -10, scaleX: base.scaleX * 1.06, scaleY: base.scaleY * .95, duration: 220, ease: 'Cubic.Out' });
      return;
    }
    this.tweens.add({ targets: figure, x: base.x - 18, y: base.y + 5, angle: -14, duration: 80, yoyo: true, hold: 100, ease: 'Quad.Out' });
  }

  animateGuardParry(side) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    if (!figure?.active) return;
    if (side === 'enemy' && this.enemyConfig.id === 'goblin') {
      this.animateGoblinGuard(true);
      return;
    }
    const baseX = figure.x;
    const baseY = figure.y;
    const baseAngle = figure.angle;
    const shift = side === 'player' ? 7 : -7;
    this.tweens.add({
      targets: figure,
      x: baseX + shift,
      y: baseY + 2,
      angle: baseAngle + (side === 'player' ? 7 : -7),
      duration: 70,
      yoyo: true,
      hold: 100,
      ease: 'Quad.Out',
      onComplete: () => { if (figure?.active) figure.setPosition(baseX, baseY).setAngle(baseAngle); },
    });
  }

  resetGoblinPose() {
    if (this.enemyConfig.id !== 'goblin' || !this.enemyFigure?.active || !this.goblinBasePose) return;
    this.tweens.killTweensOf(this.enemyFigure);
    const base = this.goblinBasePose;
    this.enemyFigure.setPosition(base.x, base.y).setScale(base.scaleX, base.scaleY).setAngle(base.angle);
  }

  cancelStrikeMotion(side) {
    const motion = this.strikeMotions?.[side];
    if (!motion) return;
    motion.tween?.stop();
    motion.timers.forEach(timer => timer.remove(false));
    if (motion.figure.active) motion.figure.setX(motion.homeX);
    delete this.strikeMotions[side];
  }

  weaponFrontOffset(figure, frameName, rightFacing) {
    const cacheKey = `${figure.texture.key}/${frameName}/${rightFacing}`;
    this.weaponFrontCache ||= new Map();
    let front = this.weaponFrontCache.get(cacheKey);
    if (front === undefined) {
      const frame = figure.texture.get(frameName);
      const source = figure.texture.getSourceImage();
      const pixels = source.getContext('2d').getImageData(frame.cutX, frame.cutY, 280, 280).data;
      front = rightFacing ? 0 : 279;
      for (let y = 8; y < 272; y++) for (let x = 8; x < 272; x++) {
        if (pixels[(y * 280 + x) * 4 + 3] < 192) continue;
        front = rightFacing ? Math.max(front, x) : Math.min(front, x);
      }
      this.weaponFrontCache.set(cacheKey, front);
    }
    return (front - figure.displayOriginX) * figure.scaleX;
  }

  strikeImpact(side) {
    const motion = this.strikeMotions?.[side];
    if (!motion || motion.hit) return;
    motion.hit = true;
    motion.tween?.stop();
    motion.figure.setX(motion.targetX);
    motion.figure.setFrame(`${motion.pose}-${motion.contact}`);
    motion.phase = 'impact';
    const hold = motion.heavy ? 180 : 120;
    motion.timers.push(this.time.delayedCall(hold, () => {
      if (!motion.figure.active) return;
      motion.phase = 'recovery';
      motion.figure.setFrame(`${motion.pose}-${motion.contact === 1 ? 2 : 3}`);
      if (motion.contact === 1) motion.timers.push(this.time.delayedCall(90, () => {
        if (motion.figure.active) motion.figure.setFrame(`${motion.pose}-3`);
      }));
      motion.tween = this.tweens.add({ targets: motion.figure, x: motion.homeX, duration: 200, ease: 'Sine.InOut' });
    }));
  }

  animateLunge(side, emphatic = false, impactDelay = emphatic ? 560 : 360) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    if (!this.inputLocked) return; // 동기 규칙 검사에는 표시용 시간축을 만들지 않는다.
    this.cancelStrikeMotion(side);
    const sign = side === 'player' ? 1 : -1;
    const pose = emphatic ? 'heavy' : 'attack';
    const contact = emphatic || (side === 'enemy' && ['orc', 'kobold'].includes(this.enemyConfig.id)) ? 2 : 1;
    const defender = side === 'player' ? this.enemyFigure : this.playerFigure;
    const contactX = defender.x - sign * 10;
    const tipOffset = this.weaponFrontOffset(figure, `${pose}-${contact}`, side === 'player');
    const targetX = contactX - tipOffset;
    const motion = { figure, pose, contact, targetX, contactX, tipOffset, heavy: emphatic, homeX: figure.x, timers: [], phase: 'anticipation', hit: false };
    (this.strikeMotions ||= {})[side] = motion;
    figure.anims.pause();
    figure.setFrame(`${pose}-0`);
    motion.tween = this.tweens.add({ targets: figure, x: motion.homeX - sign * 4, duration: Math.max(80, impactDelay - 100), ease: 'Sine.InOut' });
    motion.timers.push(this.time.delayedCall(impactDelay - 100, () => {
      if (!figure.active) return;
      motion.phase = 'swing';
      if (contact === 2) figure.setFrame(`${pose}-1`);
      motion.tween = this.tweens.add({ targets: figure, x: motion.targetX, duration: 100, ease: 'Cubic.In' });
    }));
    // 피해 처리와 같은 시점에 접촉 프레임을 확정하고, 이후에만 복귀한다.
    motion.timers.push(this.time.delayedCall(impactDelay + (emphatic ? 390 : 330), () => {
      if (!figure.active || this.strikeMotions?.[side] !== motion) return;
      this.cancelStrikeMotion(side);
      if (side === 'player') this.setPlayerPose('idle', true);
      else this.setEnemyPose('idle', true);
    }));
  }

  setHealth(side, value, animate = true) {
    const isPlayer = side === 'player';
    const hpKey = isPlayer ? 'playerHp' : 'enemyHp';
    const maxKey = isPlayer ? 'playerMaxHp' : 'enemyMaxHp';
    const bar = isPlayer ? this.playerBar : this.enemyBar;
    const text = isPlayer ? this.playerHpText : this.enemyHpText;
    const barStart = isPlayer ? 38 : 650;
    this[hpKey] = Math.max(0, Math.min(this[maxKey], value));
    text.setText(`HP ${this[hpKey]} / ${this[maxKey]}`);
    const targetWidth = 200 * this[hpKey] / this[maxKey];
    this.hpBarTweens[side]?.stop();
    this.hpBarTweens[side] = null;
    const placeBar = () => { bar.x = barStart + bar.displayWidth / 2; };
    if (!animate || Math.abs(bar.displayWidth - targetWidth) < .1) {
      bar.displayWidth = targetWidth;
      placeBar();
      return;
    }
    this.hpBarTweens[side] = this.tweens.add({
      targets: bar,
      displayWidth: targetWidth,
      duration: 320,
      ease: 'Cubic.Out',
      onUpdate: placeBar,
      onComplete: () => { this.hpBarTweens[side] = null; placeBar(); },
    });
  }

  refreshHealthUi(force = false) {
    const refresh = (side) => {
      const isPlayer = side === 'player';
      const hp = this[isPlayer ? 'playerHp' : 'enemyHp'];
      const maxHp = this[isPlayer ? 'playerMaxHp' : 'enemyMaxHp'];
      const text = isPlayer ? this.playerHpText : this.enemyHpText;
      text.setText(`HP ${hp} / ${maxHp}`);
      if (force || !this.hpBarTweens?.[side]) this.setHealth(side, hp, false);
    };
    refresh('player');
    refresh('enemy');
  }

  animateFocus(emphatic = false) {
    const baseScale = this.playerFigure.scaleX;
    this.tweens.add({
      targets: this.playerFigure,
      scaleX: baseScale * (emphatic ? 1.12 : 1.07),
      scaleY: baseScale * (emphatic ? 1.12 : 1.07),
      alpha: .72,
      duration: 130,
      yoyo: true,
      ease: 'Sine.InOut',
    });
  }

  startEnemyDownMotion() {
    if (this.enemyDownMotion || !this.enemyFigure?.active) return;
    this.enemyDownRestingY = this.enemyFigure.y;
    this.enemyDownMotion = this.tweens.add({
      targets: this.enemyFigure,
      y: this.enemyDownRestingY + 3,
      angle: 2,
      duration: 460,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  stopEnemyDownMotion() {
    if (!this.enemyDownMotion) return;
    this.enemyDownMotion.stop();
    this.enemyDownMotion = null;
    if (this.enemyFigure?.active) this.enemyFigure.setY(this.enemyDownRestingY ?? this.enemyFigure.y).setAngle(0);
    this.enemyDownRestingY = null;
  }

  collapseEnemyCharge() {
    if (!this.enemyFigure?.active) return;
    const figure = this.enemyFigure;
    const baseScaleX = figure.scaleX;
    const baseScaleY = figure.scaleY;
    figure.setTint(0xffd56a);
    this.playEffect('rhythm', figure.x, figure.y - 58, 44, false, 300, 16);
    this.tweens.add({
      targets: figure,
      scaleX: baseScaleX,
      scaleY: baseScaleY,
      angle: -4,
      duration: 120,
      yoyo: true,
      hold: 160,
      ease: 'Quad.Out',
      onComplete: () => { if (figure?.active) figure.setScale(baseScaleX, baseScaleY).setAngle(0).clearTint(); },
    });
  }

  pulseRhythm(emphatic = false) {
    this.tweens.add({
      targets: [...this.rhythmBoxes, this.rhythmText],
      scaleX: emphatic ? 1.2 : 1.1,
      scaleY: emphatic ? 1.2 : 1.1,
      duration: emphatic ? 135 : 105,
      yoyo: true,
      ease: 'Back.Out',
    });
  }

  animateIntent(intent) {
    const dangerous = intent.key === 'heavy' || intent.key === 'charge';
    this.tweens.add({
      targets: [this.intentText, this.intentDetail],
      scaleX: dangerous ? 1.1 : 1.05,
      scaleY: dangerous ? 1.1 : 1.05,
      duration: 130,
      yoyo: true,
      ease: 'Quad.Out',
    });
    if (dangerous && this.enemyFigure) {
      const baseScale = this.enemyFigure.scaleX;
      this.tweens.add({
        targets: this.enemyFigure,
        scaleX: baseScale * 1.045,
        scaleY: baseScale * 1.045,
        duration: 160,
        yoyo: true,
        ease: 'Sine.InOut',
      });
    }
    if (intent.key === 'heavy') this.cameras.main.shake(90, .0025);
  }

  lockActionInput(duration = 410) {
    this.inputLocked = true;
    this.updateActionInputs();
    if (this.actionUnlockTimer) this.actionUnlockTimer.remove(false);
    this.actionUnlockTimer = this.time.delayedCall(duration, () => {
      this.actionUnlockTimer = null;
      this.inputLocked = false;
      this.updateActionInputs();
    });
  }

  updateActionInputs() {
    const enabled = !this.over && !this.inputLocked;
    Object.values(this.buttons).forEach((button) => { button.container.input.enabled = enabled; });
    this.buttons.focus.container.input.enabled = enabled && !this.isDown();
    this.buttons.focus.container.setAlpha(enabled && !this.isDown() ? 1 : .35);
    const finisherReady = enabled && this.rhythm === 3;
    this.buttons.finisher.container.input.enabled = finisherReady;
    this.buttons.finisher.container.setAlpha(finisherReady ? 1 : .35);
  }

  tutorialOutcome(action) {
    const enemy = this.currentIntent();
    const startedDown = this.isDown();
    const defendingEnemy = enemy.key === 'defend';
    const attackingEnemy = enemy.key === 'attack' || enemy.key === 'heavy';
    const chargeInterrupted = enemy.key === 'charge' && action === 'attack';
    const outcome = { enemy, action, startedDown, playerDamage: 0, enemyDamage: 0, rhythmGain: 0, consumeRhythm: action === 'finisher', causesDown: false, chargeInterrupted, enemyRhythmGain: 0, consumeEnemyRhythm: enemy.key === 'heavy', line: '' };
    if (action === 'attack') {
      outcome.playerDamage = defendingEnemy ? 3 : 7;
      outcome.line = chargeInterrupted ? '검격이 힘 모으기를 끊었다. 적의 강공격 준비가 취소된다.' : defendingEnemy ? `${this.enemyConfig.displayName}이 방어 자세로 검격을 흘렸다. 피해가 줄었다.` : `검격이 ${this.enemyConfig.displayName}에게 적중했다.`;
    } else if (action === 'finisher') {
      outcome.playerDamage = defendingEnemy ? 8 : 16;
      outcome.line = defendingEnemy ? '강공격이 방어에 막혀 피해가 줄었다.' : '강공격! 강한 일격을 날렸다.';
    } else if (action === 'defend') {
      outcome.enemyDamage = attackingEnemy ? (enemy.key === 'heavy' ? 2 : Math.ceil(enemy.damage / 2)) : 0;
      outcome.line = attackingEnemy ? `방패를 먼저 들어 ${this.enemyConfig.displayName}의 공격을 막았다.` : '서로 방어 자세를 취했다.';
    } else if (action === 'focus') {
      outcome.rhythmGain = defendingEnemy ? 2 : 1;
      outcome.causesDown = attackingEnemy;
      if (attackingEnemy) {
        outcome.rhythmGain = 0;
        outcome.enemyDamage = enemy.damage;
        outcome.line = '집중 중 공격을 맞아 다운됐다. 다음 턴에는 집중할 수 없다.';
      } else {
        outcome.line = defendingEnemy ? `${this.enemyConfig.displayName}이 막는 동안 기를 모았다. 리듬 +2` : '기를 모았다. 리듬 +1';
      }
    }
    if (action !== 'defend' && attackingEnemy && action !== 'focus') outcome.enemyDamage = enemy.damage;
    // LEVEL_DESIGN의 공통 보상: 충전 차단·강공격 방어는 리듬 +2.
    if (chargeInterrupted || (action === 'defend' && enemy.key === 'heavy')) outcome.rhythmGain = 2;
    if (enemy.key === 'charge' && !chargeInterrupted) {
      outcome.enemyRhythmGain = 1;
      outcome.line = `${this.enemyConfig.logName}이 힘을 모아 적 리듬을 쌓았다.`;
    }
    return outcome;
  }

  showEnemyGuard() {
    this.setEnemyPose('guard', true);
    this.animateGoblinGuard();
  }

  applyTutorialEnemyHit(outcome, fromPointer = false) {
    if (!outcome.playerDamage || this.enemyHp <= 0) return;
    this.strikeImpact('player');
    this.resolutionPhase = 'collision';
    this.setHealth('enemy', this.enemyHp - outcome.playerDamage);
    const guarded = outcome.enemy.key === 'defend';
    if (guarded) {
      this.setEnemyPose('parry', true);
      this.animateGuardParry('enemy');
      this.showGuard('enemy', true);
    }
    else {
      this.setEnemyPose('hurt', true);
      this.flashCombatant('enemy', 0xeb5b67, outcome.action === 'finisher');
    }
    if (outcome.chargeInterrupted) {
      this.collapseEnemyCharge();
      this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 92, '차단!', '#ffd56a', true);
      if (fromPointer) {
        this.scheduleResolution(130, () => {
          if (!this.over && this.enemyFigure?.active) this.setEnemyPose('down', true);
        });
        this.scheduleResolution(570, () => {
          if (!this.over && this.enemyFigure?.active) this.setEnemyPose('hurt', true);
        });
      }
    }
    // 검격은 공격 시트에 있다. 몸통 접촉 표식만 작게 두고 가드는 중복하지 않는다.
    const impactX = this.enemyFigure.x - 36;
    if (!guarded) this.playEffect('attack', impactX, this.enemyFigure.y - 58, 26, false, 150, 15);
    this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 58, `-${outcome.playerDamage}`, '#ffb1b8', outcome.action === 'finisher');
  }

  applyTutorialPlayerHit(outcome) {
    if (!outcome.enemyDamage || this.playerHp <= 0 || this.enemyHp <= 0) return;
    this.strikeImpact('enemy');
    this.resolutionPhase = 'collision';
    this.setHealth('player', this.playerHp - outcome.enemyDamage);
    const blocked = outcome.action === 'defend';
    if (blocked) {
      // 방어 선택 때는 자세나 파형을 미리 보이지 않는다. 적의 타격이 닿는 순간에만
      // 가드 자세·실제 가드 효과·패링 반동을 함께 시작해 대응이 읽히게 한다.
      this.setPlayerPose('guard', true);
      this.showGuard('player', true);
      this.animateGuardParry('player');
    }
    else {
      this.setPlayerPose('hurt', true);
      this.flashCombatant('player', 0xeb5b67, false);
    }
    this.showFloatingText(this.playerFigure.x, this.playerFigure.y - 58, `-${outcome.enemyDamage}`, blocked ? '#9fdcff' : '#ffb1b8', blocked);
    if (outcome.causesDown) this.setPlayerPose('down', true);
    if (!blocked) audio.play('hit');
  }

  finishTutorialTurn(outcome, fromPointer = false) {
    this.resolutionPhase = 'complete';
    if (this.enemyHp <= 0) { this.finish(true, `${outcome.line}\n${this.enemyConfig.logName}을 쓰러뜨렸다!`); return; }
    if (this.playerHp <= 0) { this.finish(false, `${outcome.line}\n수습 기사가 쓰러졌다…`); return; }
    if (outcome.consumeRhythm) this.rhythm = 0;
    if (outcome.consumeEnemyRhythm) this.enemyRhythm = 0;
    if (outcome.enemyRhythmGain) {
      this.enemyRhythm = Math.min(3, this.enemyRhythm + outcome.enemyRhythmGain);
      this.playEffect('rhythm', this.enemyFigure.x, this.enemyFigure.y - 46, 78, this.enemyRhythm === 3);
      audio.play('charge');
    }
    if (outcome.rhythmGain) {
      this.rhythm = Math.min(3, this.rhythm + outcome.rhythmGain);
      this.playEffect('rhythm', 185, 432, outcome.rhythmGain === 2 ? 98 : 76, outcome.rhythmGain === 2);
      this.showFloatingText(this.playerFigure.x, 158, `리듬 +${outcome.rhythmGain}`, '#ffd56a', outcome.rhythmGain === 2);
      this.pulseRhythm(outcome.rhythmGain === 2);
      audio.play('rhythm');
    }
    this.downTurns = outcome.causesDown ? 1 : outcome.startedDown ? 0 : 0;
    // 공격으로 충전을 끊으면 다음 공격 칸(예약 강공격 후보)도 지나간다.
    const nextBaseIntent = this.intentQueue[(this.turn + 1) % this.intentQueue.length];
    this.turn += outcome.chargeInterrupted && nextBaseIntent.key === 'attack' ? 2 : 1;
    this.log = outcome.line;
    if (this.isDown()) this.setPlayerPose('down', true);
    else if (outcome.startedDown) {
      this.setPlayerPose('hurt', true);
      this.scheduleResolution(380, () => { if (!this.over) this.setPlayerPose('idle', true); });
    } else this.setPlayerPose('idle', true);
    this.setEnemyPose('idle', true);
    this.resetGoblinPose();
    // 다운 뒤 행동은 일어서는 프레임을 읽은 뒤에만 다시 누를 수 있게 한다.
    if (fromPointer && outcome.startedDown && !outcome.causesDown) {
      this.inputLocked = true;
      this.scheduleResolution(380, () => {
        if (!this.over) {
          this.inputLocked = false;
          this.updateActionInputs();
        }
      });
    } else this.inputLocked = false;
    this.render();
  }

  resolveTutorialTurn(action, fromPointer) {
    const outcome = this.tutorialOutcome(action);
    const playerStrike = action === 'attack' || action === 'finisher';
    const strikeDuration = action === 'finisher' ? 560 : 360;
    const enemyIsHeavy = outcome.enemy.key === 'heavy';
    const enemyStrikeDuration = enemyIsHeavy ? 520 : 360;
    const beginPlayerStrike = () => {
      this.setPlayerPose(action === 'finisher' ? 'heavy' : 'attack', true);
      this.animateLunge('player', action === 'finisher');
      if (action === 'finisher') this.cameras.main.shake(110, .004);
      audio.play(action === 'finisher' ? 'finisher' : 'attack');
    };
    const beginEnemyStrike = () => {
      if (this.enemyHp <= 0) return;
      this.setEnemyPose(enemyIsHeavy ? 'heavy' : 'attack', true);
      this.animateLunge('enemy', enemyIsHeavy, enemyStrikeDuration);
      if (enemyIsHeavy) this.cameras.main.shake(90, .0025);
      audio.play(enemyIsHeavy ? 'heavy' : 'enemyAttack');
    };
    const beginEnemyCharge = () => {
      if (this.enemyHp <= 0) return;
      this.setEnemyPose('charge', true);
      audio.play('charge');
    };
    const showPlayerGuardSelection = () => {
      this.setPlayerPose('guard', true);
      this.showFloatingText(this.playerFigure.x, this.playerFigure.y - 76, '방어 준비', '#8ec5ff');
    };
    const beginFocus = () => { this.setPlayerPose('focus', true); audio.play('focus'); };
    const finish = () => this.finishTutorialTurn(outcome, fromPointer);

    if (!fromPointer) {
      if (outcome.enemy.key === 'defend') this.showEnemyGuard();
      if (action === 'defend') showPlayerGuardSelection();
      else if (action === 'focus') beginFocus();
      else beginPlayerStrike();
      this.applyTutorialEnemyHit(outcome, false);
      if (outcome.enemy.key === 'charge') beginEnemyCharge();
      else if (outcome.enemy.key === 'attack' || outcome.enemy.key === 'heavy') beginEnemyStrike();
      this.applyTutorialPlayerHit(outcome);
      finish();
      return;
    }

    this.inputLocked = true;
    this.resolutionPhase = 'preparing';
    this.updateActionInputs();
    this.clearResolutionTimers();
    if (outcome.enemy.key === 'defend') {
      this.showEnemyGuard();
      if (playerStrike) {
        this.scheduleResolution(360, beginPlayerStrike);
        this.scheduleResolution(360 + strikeDuration, () => this.applyTutorialEnemyHit(outcome, true));
        this.scheduleResolution(action === 'finisher' ? 1380 : 1280, finish);
      } else if (action === 'defend') {
        showPlayerGuardSelection();
        this.scheduleResolution(980, finish);
      } else {
        beginFocus();
        this.scheduleResolution(420, this.showEnemyGuard.bind(this));
        this.scheduleResolution(1150, finish);
      }
      return;
    }

    if (outcome.enemy.key === 'charge') {
      beginEnemyCharge();
      if (playerStrike) {
        beginPlayerStrike();
        this.scheduleResolution(strikeDuration, () => this.applyTutorialEnemyHit(outcome, true));
        this.scheduleResolution(760 + strikeDuration, finish);
      } else {
        if (action === 'defend') showPlayerGuardSelection(); else beginFocus();
        this.scheduleResolution(1050, finish);
      }
      return;
    }

    if (action === 'defend') {
      showPlayerGuardSelection();
      this.scheduleResolution(440, beginEnemyStrike);
      this.scheduleResolution(440 + enemyStrikeDuration, () => this.applyTutorialPlayerHit(outcome));
      this.scheduleResolution(enemyIsHeavy ? 1560 : 1280, finish);
    } else if (action === 'focus') {
      beginFocus();
      this.scheduleResolution(460, beginEnemyStrike);
      this.scheduleResolution(460 + enemyStrikeDuration, () => this.applyTutorialPlayerHit(outcome));
      this.scheduleResolution(1060 + enemyStrikeDuration, finish);
    } else {
      beginPlayerStrike();
      this.scheduleResolution(strikeDuration, () => this.applyTutorialEnemyHit(outcome, true));
      this.scheduleResolution(420 + strikeDuration, beginEnemyStrike);
      this.scheduleResolution(420 + enemyStrikeDuration + strikeDuration, () => this.applyTutorialPlayerHit(outcome));
      this.scheduleResolution((enemyIsHeavy ? 1540 : 1220) + strikeDuration, finish);
    }
  }

  resolveBossTurn(action, fromPointer) {
    const enemy = this.currentBossIntent();
    const exposed = this.sealBroken;
    const strike = action === 'attack' || action === 'finisher';
    const heavy = action === 'finisher';
    const guarding = enemy.key === 'defend';
    const attacking = enemy.key === 'attack' || enemy.key === 'heavy';
    const interrupted = enemy.key === 'charge' && action === 'attack';
    const blockedHeavy = enemy.key === 'heavy' && action === 'defend';
    const opensSeal = interrupted || blockedHeavy;
    const down = action === 'focus' && attacking;
    const playerDamage = strike ? (heavy ? (guarding ? 8 : exposed ? this.enemyConfig.boss.exposedFinisherDamage : 16) : guarding ? 3 : 7) : 0;
    const enemyDamage = attacking ? (action === 'defend' ? (enemy.key === 'heavy' ? 2 : Math.ceil(enemy.damage / 2)) : enemy.damage) : 0;
    const gain = interrupted || blockedHeavy ? 2 : action === 'focus' && !attacking ? (guarding ? 2 : 1) : 0;
    const lines = [];
    const at = (delay, callback) => {
      if (fromPointer) this.scheduleResolution(delay, () => { if (!this.over) callback(); });
      else if (!this.over) callback();
    };
    // 선택은 입력 시 고정하고 HP와 결과는 각 타격 시점에 반영한다.
    this.sealBroken = false;
    this.bossDown = false;
    this.stopEnemyDownMotion();
    this.resolutionPhase = 'prepare';
    if (fromPointer) {
      this.lockActionInput(2600);
      this.log = '행동 중…';
      if (guarding) this.setEnemyPose('guard', true);
      else if (enemy.key === 'charge') this.setEnemyPose('charge', true);
      if (action === 'defend') this.setPlayerPose('guard', true);
      else if (action === 'focus') { this.setPlayerPose('focus', true); this.animateFocus(guarding); }
      this.render();
    }
    const impact = heavy ? 680 : 480;
    const enemyStart = strike ? impact + 400 : 320;
    const enemyImpact = enemyStart + (enemy.key === 'heavy' ? 620 : 400);
    const endTime = (attacking ? enemyImpact : strike ? impact : 500) + 700;
    if (strike) {
      at(180, () => { this.setPlayerPose(heavy ? 'heavy' : 'attack', true); this.animateLunge('player', heavy, impact - 180); });
      at(impact, () => {
        this.strikeImpact('player');
        this.resolutionPhase = 'collision';
        if (heavy) this.rhythm = 0;
        this.setHealth('enemy', this.enemyHp - playerDamage);
        this.setEnemyPose(interrupted ? 'down' : guarding ? 'guard' : 'hurt', true);
        if (guarding) { this.showGuard('enemy', true); this.animateGuardParry('enemy'); }
        else this.flashCombatant('enemy', 0xeb5b67, heavy);
        if (!guarding) this.playEffect('attack', this.enemyFigure.x - 36, this.enemyFigure.y - 58, 26, false, 150, 15);
        this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 58, `-${playerDamage}`, guarding ? '#9fdcff' : '#ffb1b8', heavy);
        audio.play(heavy ? 'finisher' : 'attack');
        lines.push(guarding ? `적이 막았다. 피해 ${playerDamage}.` : `${heavy ? '강공격' : '공격'} ${playerDamage} 피해.`);
        if (interrupted) {
          this.bossDown = true;
          this.startEnemyDownMotion();
          this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 92, '차단', '#ffd56a', true);
          lines.push('힘 모으기 차단. 다음 공격을 건너뛴다.');
          audio.play('interrupt');
        }
        this.log = lines.join(' · ');
        this.render();
        if (this.enemyHp <= 0) this.finish(true, `${this.log}\n심판관을 쓰러뜨렸다!`);
      });
    }
    if (attacking) {
      at(enemyStart, () => {
        if (strike) this.setPlayerPose('idle', true);
        this.setEnemyPose(enemy.key === 'heavy' ? 'heavy' : 'attack', true);
        this.animateLunge('enemy', enemy.key === 'heavy', enemyImpact - enemyStart);
      });
      at(enemyImpact, () => {
        this.strikeImpact('enemy');
        this.resolutionPhase = 'collision';
        this.setHealth('player', this.playerHp - enemyDamage);
        this.setPlayerPose(down ? 'down' : action === 'defend' ? 'guard' : 'hurt', true);
        if (action === 'defend') { this.showGuard('player', true); this.animateGuardParry('player'); }
        else this.flashCombatant('player', 0xeb5b67, enemy.key === 'heavy');
        this.showFloatingText(this.playerFigure.x, this.playerFigure.y - 58, `-${enemyDamage}`, action === 'defend' ? '#9fdcff' : '#ffb1b8', blockedHeavy);
        lines.push(down ? '집중이 끊겼다. 다음 턴 집중 불가.' : action === 'defend' ? `방어. 피해 ${enemyDamage}.` : `반격에 ${enemyDamage} 피해.`);
        audio.play(action === 'defend' ? 'defend' : 'hit');
        if (down) this.downTurns = 1;
        this.log = lines.join(' · ');
        this.render();
        if (this.playerHp <= 0) this.finish(false, `${this.log}\n수습 기사가 쓰러졌다.`);
      });
    }
    at(endTime, () => {
      this.rhythm = Math.min(3, this.rhythm + gain);
      if (gain) { this.showFloatingText(this.playerFigure.x, 158, `리듬 +${gain}`, '#ffd56a', gain === 2); this.pulseRhythm(gain === 2); audio.play('rhythm'); }
      if (enemy.key === 'charge' && !interrupted) {
        this.enemyRhythm = Math.min(3, this.enemyRhythm + 1);
        lines.push('심판관이 힘을 모았다.');
        audio.play('charge');
      }
      if (enemy.key === 'heavy') this.enemyRhythm = 0;
      this.downTurns = down ? 1 : 0;
      this.sealBroken = opensSeal;
      if (opensSeal) { lines.push('봉인 노출. 다음 강공격 24 피해.'); audio.play('seal'); }
      if (gain) lines.push(`리듬 +${gain}`);
      if (!lines.length) lines.push('서로 방어하며 한 턴을 보냈다.');
      if (this.phase === 1 && this.enemyHp <= this.enemyConfig.boss.phaseThreshold) {
        this.phase = 2;
        this.phaseText.setText('심장석 균열');
        audio.play('phase');
      }
      this.turn += 1;
      if (opensSeal) this.bossBundleIndex = this.bossBundle.length - 1;
      else this.bossBundleIndex += 1;
      if (enemy.bossFinisher && !opensSeal) this.selectBossBundle();
      this.setPlayerPose(down ? 'down' : 'idle', true);
      if (!this.bossDown) this.setEnemyPose('idle', true);
      this.log = lines.join(' · ');
      this.resolutionPhase = 'idle';
      if (this.actionUnlockTimer) this.actionUnlockTimer.remove(false);
      this.actionUnlockTimer = null;
      this.inputLocked = false;
      this.render();
    });
  }

  takeTurn(action, fromPointer = false) {
    if (this.over || (fromPointer && this.inputLocked) || !['attack', 'defend', 'focus', 'finisher'].includes(action) || (action === 'finisher' && this.rhythm < 3)) return;
    if (action === 'focus' && this.isDown()) return;
    if (this.isPatternEnemy()) {
      this.resolveTutorialTurn(action, fromPointer);
      return;
    }
    if (this.enemyConfig.boss) {
      this.resolveBossTurn(action, fromPointer);
      return;
    }
  }

  finish(won, message) {
    if (this.over) return;
    this.over = true;
    this.log = message;
    Object.values(this.buttons).forEach(b => { b.container.input.enabled = false; });
    if (won) {
      this.sealBroken = false;
      this.render();
      if (this.enemyConfig.boss) {
        this.log = '봉인이 풀리며 심장석의 빛이 고르게 번진다.';
        this.render();
        this.playEffect('rhythm', this.enemyFigure.x, this.enemyFigure.y, 250, true);
        audio.play('victory');
        this.tweens.add({ targets: this.enemyFigure, alpha: 0, duration: 800 });
        this.scheduleBossVictoryTransition();
        return;
      }
      this.advanceAfterVictory();
      return;
    }
    Object.values(this.buttons).forEach(b => b.container.setVisible(false));
    this.restartButton.container.setVisible(true); this.render();
  }

  advanceAfterVictory() {
    const nextIndex = this.enemyIndex + 1;
    const hasNextBattle = nextIndex < this.battleOrder.length;
    if (hasNextBattle) {
      const nextEnemy = ENEMY_PRESETS[this.battleOrder[nextIndex]];
      const carriedPlayerHp = nextEnemy?.boss
        ? this.playerMaxHp
        : Math.min(this.playerMaxHp, this.playerHp + GENERAL_BATTLE_HEAL);
      this.registry.set('carriedPlayerHp', carriedPlayerHp);
      this.registry.set('defeatedEnemyId', this.enemyConfig.id);
      this.registry.set('battleIndex', nextIndex);
      this.scene.start('battleTransition');
      return;
    }
    this.registry.set('battleIndex', 0);
    this.scene.start('ending');
  }

  render(forceHealthSync = false) {
    const enemy = this.currentIntent();
    const intentColors = { attack: '#ff929b', heavy: '#ffad64', defend: '#8ec5ff', charge: '#d898ff' };
    const intentColor = intentColors[enemy.key] || '#ffd56a';
    const tutorial = this.isTutorial();
    const patternEnemy = this.isPatternEnemy();
    const boss = !!this.enemyConfig.boss;
    const headline = this.over ? (this.enemyHp <= 0 ? '승리!' : '패배…') : tutorial ? '첫 전투 · 고블린 정찰병' : `성소 ${this.enemyIndex + 1}구역`;
    const detail = this.over ? (this.enemyHp <= 0 ? '길을 막던 적이 쓰러졌다.' : '이 전투의 처음부터 다시 도전할 수 있다.') : tutorial ? '고블린은 공격과 방어 자세를 반복합니다.' : '적은 같은 동작을 반복한다. 빈틈을 찾아보자.';
    this.intentText.setText(headline).setColor(patternEnemy && !this.over ? '#ffd56a' : intentColor);
    this.intentDetail.setText(detail);
    this.intentPanel.setVisible(!boss && (tutorial || this.over)).setStrokeStyle(1, 0x776344);
    this.intentText.setVisible(!boss || this.over);
    this.intentDetail.setVisible((!boss && tutorial) || this.over);
    if (!boss && !patternEnemy && !this.over && this.lastIntentKey !== enemy.key) {
      this.lastIntentKey = enemy.key;
      this.animateIntent(enemy);
    }
    this.refreshHealthUi(forceHealthSync);
    this.rhythmBoxes.forEach((box, i) => box.setFillStyle(i < this.rhythm ? this.colors.gold : 0x362746)); this.rhythmText.setText(`${this.rhythm} / 3`);
    this.updateActionInputs();
    const finisher = this.buttons.finisher; finisher.bg.setFillStyle(finisher.color);
    this.sealText.setVisible(boss && !this.over).setText(this.sealBroken ? '봉인 노출 · 이번 행동까지\n강공격 24 피해' : '봉인 닫힘 · 강공격 16 피해');
    if (this.sealRune) this.sealRune.setVisible(this.sealBroken && !this.over);
    this.downText.setText(this.isDown() && !this.over ? '다운 · 이번 턴 집중 불가' : '').setVisible(this.isDown() && !this.over);
    this.logText.setText(this.log);
  }
}

class EndingScene extends Phaser.Scene {
  constructor() { super('ending'); }

  create() {
    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x171024);
    pixelSprite(this, WIDTH / 2, 282, 'shrine-kit', 'arch', 420, .34);
    shrineLanding(this, 464);
    pixelSprite(this, 450, 184, 'shrine-kit', 'rune', 172, .9);
    this.add.sprite(245, 410, 'novice-combat-sheet', 'idle-0').setScale(164 / 280).play('novice-idle');
    this.add.text(WIDTH / 2, 106, '심장석 복구 완료', { fontFamily: UI_FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.add.rectangle(555, 370, 460, 150, 0x171024, .94).setStrokeStyle(1, 0x776344);
    this.add.text(555, 329, '심장석이 다시 뛰기 시작했다.', { fontFamily: UI_FONT, fontSize: '20px', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(555, 388, '제단의 균열이 닫히고, 검을 내려놓는다.\n성소에 고요가 돌아왔다.', { fontFamily: UI_FONT, fontSize: '16px', color: '#c6b6d8', align: 'center', lineSpacing: 12 }).setOrigin(.5);
    this.makeButton('입구로 돌아가기', 450, 510, 220, 50, 0x765199, () => this.scene.start('intro'));
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(1, 0xb3a384);
    const text = this.add.text(0, 0, label, { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0x786747));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', () => { audio.activate(); audio.play('button'); callback(); });
  }
}

class BattleTransitionScene extends Phaser.Scene {
  constructor() { super('battleTransition'); }

  create() {
    const nextIndex = this.registry.get('battleIndex') || 1;
    const battleOrder = this.registry.get('battleOrder') || ENEMY_ORDER;
    const currentEnemyId = this.registry.get('defeatedEnemyId');
    const currentEnemy = ENEMY_PRESETS[currentEnemyId] || {};
    const nextEnemyId = battleOrder[nextIndex];
    const nextEnemy = ENEMY_PRESETS[nextEnemyId];

    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x171024);
    this.add.rectangle(WIDTH / 2, 314, 740, 300, 0x2a1d3b).setStrokeStyle(1, 0x776344);
    const defeatedName = (currentEnemy && currentEnemy.displayName) || '적';
    const nextEnemyName = (nextEnemy && nextEnemy.displayName) || '다음 적';
    const flow = DUNGEON_FLOW[nextEnemy?.id] || { zone: '성소 깊은 곳', threat: `${nextEnemyName}가 길을 막는다.` };
    this.add.text(WIDTH / 2, 110, flow.zone, { fontFamily: UI_FONT, fontSize: '24px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 143, `${defeatedName} 처치`, { fontFamily: UI_FONT, fontSize: '17px', color: '#c6b6d8' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 194, nextEnemyName, { fontFamily: UI_FONT, fontSize: '20px', fontStyle: 'bold', color: '#f8f1ff' }).setOrigin(.5);
    const carriedPlayerHp = this.registry.get('carriedPlayerHp');
    const preparation = typeof carriedPlayerHp === 'number'
      ? (nextEnemy.boss
        ? '전투 준비: HP 완전 회복 · 리듬 0으로 시작'
        : `전투 준비: HP ${carriedPlayerHp} · 일반전 승리 +${GENERAL_BATTLE_HEAL} 회복 · 리듬 0으로 시작`)
      : '전투 준비: HP 34 · 리듬 0으로 시작';
    this.add.text(WIDTH / 2, 238, preparation, { fontFamily: UI_FONT, fontSize: '14px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    if (nextEnemy.boss) {
      this.add.text(WIDTH / 2, 302, '마지막 수호가 기다립니다. 힘 모으기는 공격으로 끊고, 강공격은 방어로 버티세요.\n열린 봉인에 다음 행동으로 강공격을 넣으면 24 피해를 줍니다.', { fontFamily: UI_FONT, fontSize: '14px', color: '#f8f1ff', align: 'center', lineSpacing: 9 }).setOrigin(.5);
    } else {
      this.add.text(WIDTH / 2, 292, flow.threat, { fontFamily: UI_FONT, fontSize: '14px', color: '#f8f1ff', align: 'center' }).setOrigin(.5);
    }
    this.makeButton(nextEnemy.boss ? '심판관과 전투' : '다음 적과 전투', WIDTH / 2, 416, 240, 52, 0x4e6045, () => this.scene.start('battle'));
    this.makeButton('입구로 돌아가기', WIDTH / 2, 500, 230, 48, 0x765199, () => {
      this.registry.set('battleIndex', 0);
      this.scene.start('intro');
    });
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(1, 0xb3a384);
    const text = this.add.text(0, 0, label, { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0x786747));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', () => { audio.activate(); audio.play('button'); callback(); });
  }
}

const game = new Phaser.Game({ type: Phaser.AUTO, width: WIDTH, height: HEIGHT, parent: 'game', backgroundColor: '#171024', scene: [BootScene, IntroScene, BattleScene, BattleTransitionScene, EndingScene], render: { antialias: false, pixelArt: true }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
window.__battleGame = game;
