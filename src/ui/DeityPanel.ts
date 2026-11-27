import type { DeityStance, DivineEventType, PrayerIntent, Vec2 } from '@core/Types';
import { DIVINE_EVENT_CATALOG } from '@simulation/deity/DivineEvents';
import { DEITY_STANCE_LABELS, PRAYER_INTENT_LABELS } from '@simulation/deity/ProceduralGod';
import type { WorldState } from '@simulation/WorldState';

const INFLUENCE_CONDITION_KEY: Record<DivineEventType, string> = {
  great_deluge: 'flood',
  scorching_drought: 'heatwave',
  polar_snap: 'freeze',
  ashen_miasma: 'miasma',
  habitat_clearing: 'scars',
  sanctuary_rewilding: 'rewilding',
  migration_corridor: 'rewilding',
  sunlit_blessing: 'rewilding',
};

export class DeityPanel {
  readonly element: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly feedbackEl: HTMLElement;
  private readonly whisperButtons: HTMLButtonElement[] = [];
  private readonly stanceButtons = new Map<DeityStance, HTMLButtonElement>();
  private readonly chipCycleIndex = new Map<string, number>();
  private readonly lastConditionPositions = new Map<string, Vec2>();
  private open = true;
  private activeInfluencePos: Vec2 | null = null;
  private lastWorld: WorldState | null = null;
  private lastSocialTone: 'good' | 'calm' | 'warn' | 'bad' = 'calm';
  private lastBodyHtml = '';
  private lastStatusHtml = '';
  private lastCooling: boolean | null = null;
  private lastStance: DeityStance | null = null;

  constructor(
    private readonly onWhisper: (intent: PrayerIntent) => string,
    private readonly onClose: () => void,
    private readonly onFocusPosition?: (pos: Vec2) => void,
    private readonly onSetStance?: (stance: DeityStance) => string,
  ) {
    this.element = document.createElement('aside');
    this.element.className = 'hud-deity glass-panel';

    const title = document.createElement('div');
    title.className = 'panel-header';
    title.title = 'Drag to move · Double-click to reset position';

    const titleLabel = document.createElement('span');
    titleLabel.textContent = '✦ Deity';

    const headerActions = document.createElement('div');
    headerActions.className = 'panel-header-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close Deity panel';
    closeBtn.setAttribute('aria-label', 'Close Deity panel');
    closeBtn.addEventListener('click', () => this.onClose());

    headerActions.append(closeBtn);
    title.append(titleLabel, headerActions);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'deity-body';

    const whisperSection = document.createElement('div');
    whisperSection.className = 'whisper-section';

    const stanceLabel = document.createElement('div');
    stanceLabel.className = 'whisper-label';
    stanceLabel.textContent = 'Disposition';

    const stanceRow = document.createElement('div');
    stanceRow.className = 'stance-row';
    const stances: [DeityStance, string, string][] = [
      ['benevolent', `🌱 ${DEITY_STANCE_LABELS.benevolent}`, 'Good: rewilding, climate healing & peaceful cooperation'],
      ['neutral', `⚖️ ${DEITY_STANCE_LABELS.neutral}`, 'Neutral: autonomous natural ebb and flow'],
      ['destructive', `🔥 ${DEITY_STANCE_LABELS.destructive}`, 'Bad: habitat destruction, climate crisis & warlike conflict'],
    ];
    for (const [stance, label, tip] of stances) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hud-btn small stance-btn stance-${stance}`;
      btn.textContent = label;
      btn.title = tip;
      btn.addEventListener('click', () => {
        if (!this.onSetStance) return;
        const msg = this.onSetStance(stance);
        this.feedbackEl.textContent = msg;
      });
      this.stanceButtons.set(stance, btn);
      stanceRow.appendChild(btn);
    }

    const whisperLabel = document.createElement('div');
    whisperLabel.className = 'whisper-label';
    whisperLabel.textContent = 'Invoke Environmental Act';

    const btnGrid = document.createElement('div');
    btnGrid.className = 'whisper-grid';

    const intents: [PrayerIntent, string, string, 'good' | 'bad'][] = [
      ['prosperity', `🌱 ${PRAYER_INTENT_LABELS.prosperity}`, 'Replant scarred clearings, regrow forests & foster fellowship', 'good'],
      ['peace', `☀️ ${PRAYER_INTENT_LABELS.peace}`, 'Quell active climate disasters, clear skies & reconcile rivals', 'good'],
      ['drama', `🪓 ${PRAYER_INTENT_LABELS.drama}`, 'Strip woodland canopy, scar habitats & ignite territorial competition', 'bad'],
      ['mystery', `🔥 ${PRAYER_INTENT_LABELS.mystery}`, 'Unleash drought, smog, deluge or freeze — driving scarcity & conflict', 'bad'],
    ];

    for (const [intent, label, tip, polarity] of intents) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hud-btn small whisper-${polarity}`;
      btn.textContent = label;
      btn.title = tip;
      btn.addEventListener('click', () => {
        const msg = this.onWhisper(intent);
        this.feedbackEl.textContent = msg;
      });
      this.whisperButtons.push(btn);
      btnGrid.appendChild(btn);
    }

    this.feedbackEl = document.createElement('div');
    this.feedbackEl.className = 'whisper-feedback';
    this.feedbackEl.textContent = 'Steer the unseen hand or invoke an act...';

    whisperSection.append(this.feedbackEl, stanceLabel, stanceRow, whisperLabel, btnGrid);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'deity-status';
    this.statusEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      const chipEl = target?.closest('.eco-chip[data-eco-key]') as HTMLElement | null;
      if (chipEl && this.onFocusPosition) {
        const key = chipEl.dataset?.ecoKey ?? chipEl.getAttribute?.('data-eco-key');
        if (key && this.lastWorld) {
          const targets = this.resolveStatusTargets(key, this.lastWorld, this.lastSocialTone);
          if (targets && targets.length > 0) {
            const idx = this.chipCycleIndex.get(key) ?? 0;
            const chosen = targets[idx % targets.length];
            this.chipCycleIndex.set(key, (idx + 1) % targets.length);
            this.onFocusPosition({ x: chosen.x, z: chosen.z });
            return;
          }
        }
      }
      if (target?.closest('.deity-epoch-banner') && this.activeInfluencePos && this.onFocusPosition) {
        this.onFocusPosition(this.activeInfluencePos);
      }
    });

    this.element.append(title, this.bodyEl, whisperSection, this.statusEl);
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.element.classList.toggle('hidden', !open);
  }

  private recordActiveEffectPositions(world: WorldState): void {
    for (const inf of world.activeInfluences) {
      const key = INFLUENCE_CONDITION_KEY[inf.type];
      if (key) {
        this.lastConditionPositions.set(key, { x: inf.position.x, z: inf.position.z });
      }
    }
    for (const fx of world.activeDivineEffects) {
      const key = INFLUENCE_CONDITION_KEY[fx.type];
      if (key && !this.lastConditionPositions.has(key)) {
        this.lastConditionPositions.set(key, { x: fx.position.x, z: fx.position.z });
      }
    }
  }

  private dedupePositions(positions: readonly Vec2[], minDist = 6): Vec2[] {
    const out: Vec2[] = [];
    const minDistSq = minDist * minDist;
    for (const pos of positions) {
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) continue;
      const duplicate = out.some((p) => {
        const dx = p.x - pos.x;
        const dz = p.z - pos.z;
        return dx * dx + dz * dz < minDistSq;
      });
      if (!duplicate) {
        out.push({ x: pos.x, z: pos.z });
      }
    }
    return out;
  }

  private collectInfluencePositions(world: WorldState, types: readonly DivineEventType[]): Vec2[] {
    const out: Vec2[] = [];
    for (const inf of world.activeInfluences) {
      if (types.includes(inf.type)) {
        out.push({ x: inf.position.x, z: inf.position.z });
      }
    }
    for (const fx of world.activeDivineEffects) {
      if (types.includes(fx.type)) {
        out.push({ x: fx.position.x, z: fx.position.z });
      }
    }
    return out;
  }

  private getFallbackSettlementPositions(world: WorldState): Vec2[] {
    const out: Vec2[] = [];
    const favoredId = world.deity.favoredSettlementId;
    if (favoredId) {
      const favored = world.getSettlement(favoredId);
      if (favored) out.push({ x: favored.center.x, z: favored.center.z });
    }
    for (const s of world.settlements) {
      out.push({ x: s.center.x, z: s.center.z });
    }
    return out;
  }

  private resolveStatusTargets(
    key: string,
    world: WorldState,
    socialTone: 'good' | 'calm' | 'warn' | 'bad',
  ): Vec2[] {
    const out: Vec2[] = [];

    if (key === 'flood') {
      out.push(...this.collectInfluencePositions(world, ['great_deluge']));
      const cached = this.lastConditionPositions.get('flood');
      if (cached) out.push(cached);
      const lowSettlements = [...world.settlements].sort((a, b) => a.groundY - b.groundY);
      if (lowSettlements[0]) out.push({ x: lowSettlements[0].center.x, z: lowSettlements[0].center.z });
    } else if (key === 'heatwave') {
      out.push(...this.collectInfluencePositions(world, ['scorching_drought']));
      const cached = this.lastConditionPositions.get('heatwave');
      if (cached) out.push(cached);
      out.push(...this.getFallbackSettlementPositions(world));
    } else if (key === 'freeze') {
      out.push(...this.collectInfluencePositions(world, ['polar_snap']));
      const cached = this.lastConditionPositions.get('freeze');
      if (cached) out.push(cached);
      const highSettlements = [...world.settlements].sort((a, b) => b.groundY - a.groundY);
      if (highSettlements[0]) out.push({ x: highSettlements[0].center.x, z: highSettlements[0].center.z });
    } else if (key === 'miasma') {
      out.push(...this.collectInfluencePositions(world, ['ashen_miasma']));
      const cached = this.lastConditionPositions.get('miasma');
      if (cached) out.push(cached);
      const dense = [...world.settlements].sort((a, b) => b.getCompletedCount() - a.getCompletedCount());
      if (dense[0]) out.push({ x: dense[0].center.x, z: dense[0].center.z });
    } else if (key === 'scars') {
      for (const scar of world.habitatScars) {
        out.push({ x: scar.x, z: scar.z });
      }
      out.push(...this.collectInfluencePositions(world, ['habitat_clearing']));
      const cached = this.lastConditionPositions.get('scars');
      if (cached) out.push(cached);
    } else if (key === 'rewilding') {
      out.push(
        ...this.collectInfluencePositions(world, [
          'sanctuary_rewilding',
          'migration_corridor',
          'sunlit_blessing',
        ]),
      );
      const cached = this.lastConditionPositions.get('rewilding');
      if (cached) out.push(cached);
      for (const scar of world.habitatScars) {
        out.push({ x: scar.x, z: scar.z });
      }
      out.push(...this.getFallbackSettlementPositions(world));
    } else if (key === 'balance') {
      for (const cel of world.festivals.activeCelebrations) {
        out.push({ x: cel.position.x, z: cel.position.z });
      }
      out.push(...this.getFallbackSettlementPositions(world));
    } else if (key === 'wars') {
      // Prioritize active battle sparks & fighting creatures, then battlefields (when mustering/marching) and warring settlements
      for (const spark of world.activeCombatSparks) {
        out.push({ x: spark.position.x, z: spark.position.z });
      }
      for (const c of world.creatures) {
        if (c.alive && c.activity === 'fighting') {
          out.push({ x: c.x, z: c.z });
        }
      }
      const hadActiveCombat = out.length > 0;
      if (!hadActiveCombat) {
        for (const war of world.wars.activeWars) {
          out.push({ x: war.battlefield.x, z: war.battlefield.z });
        }
        for (const c of world.creatures) {
          if (c.alive && c.activity === 'marching' && c.activeWarId) {
            out.push({ x: c.x, z: c.z });
          }
        }
      }
      const warPairs = world.diplomacy.getPairsByStance(world.settlements, 'war');
      for (const [a, b] of warPairs) {
        out.push({ x: a.center.x, z: a.center.z }, { x: b.center.x, z: b.center.z });
      }
      if (hadActiveCombat) {
        for (const war of world.wars.activeWars) {
          out.push({ x: war.battlefield.x, z: war.battlefield.z });
        }
      }
    } else if (key === 'alliances') {
      const alliedPairs = world.diplomacy.getPairsByStance(world.settlements, 'allied');
      const alliedIds = new Set<string>();
      for (const [a, b] of alliedPairs) {
        alliedIds.add(a.id);
        alliedIds.add(b.id);
      }
      for (const cel of world.festivals.activeCelebrations) {
        if (alliedIds.has(cel.hostSettlementId)) {
          out.push({ x: cel.position.x, z: cel.position.z });
        }
      }
      for (const c of world.creatures) {
        if (
          c.alive &&
          c.activity === 'trading' &&
          c.tradeDestinationSettlementId &&
          world.diplomacy.getStance(c.settlementId, c.tradeDestinationSettlementId) === 'allied'
        ) {
          out.push({ x: c.x, z: c.z });
        }
      }
      for (const [a, b] of alliedPairs) {
        out.push({ x: a.center.x, z: a.center.z }, { x: b.center.x, z: b.center.z });
      }
    } else if (key === 'social') {
      if (socialTone === 'bad' || socialTone === 'warn') {
        for (const spark of world.activeCombatSparks) {
          out.push({ x: spark.position.x, z: spark.position.z });
        }
        for (const c of world.creatures) {
          if (c.alive && c.activity === 'fighting') {
            out.push({ x: c.x, z: c.z });
          }
        }
        for (const war of world.wars.activeWars) {
          out.push({ x: war.battlefield.x, z: war.battlefield.z });
        }
        for (const [a, b] of world.diplomacy.getPairsByStance(world.settlements, 'war')) {
          out.push({ x: a.center.x, z: a.center.z }, { x: b.center.x, z: b.center.z });
        }
        for (const [a, b] of world.diplomacy.getPairsByStance(world.settlements, 'tense')) {
          out.push({ x: a.center.x, z: a.center.z }, { x: b.center.x, z: b.center.z });
        }
      } else if (socialTone === 'good') {
        for (const cel of world.festivals.activeCelebrations) {
          out.push({ x: cel.position.x, z: cel.position.z });
        }
        for (const c of world.creatures) {
          if (c.alive && (c.activity === 'celebrating' || c.activity === 'socialising')) {
            out.push({ x: c.x, z: c.z });
            if (out.length >= 4) break;
          }
        }
        for (const [a, b] of world.diplomacy.getPairsByStance(world.settlements, 'allied')) {
          out.push({ x: a.center.x, z: a.center.z }, { x: b.center.x, z: b.center.z });
        }
      } else {
        for (const cel of world.festivals.activeCelebrations) {
          out.push({ x: cel.position.x, z: cel.position.z });
        }
      }
      out.push(...this.getFallbackSettlementPositions(world));
    }

    if (out.length === 0) {
      out.push(...this.getFallbackSettlementPositions(world));
    }
    return this.dedupePositions(out);
  }

  update(world: WorldState): void {
    if (!this.open) return;
    this.lastWorld = world;
    const d = world.deity;
    const favored = d.favoredSettlementId ? world.getSettlement(d.favoredSettlementId)?.name : 'None yet';

    this.recordActiveEffectPositions(world);

    // Active ecological influence banner (rare, weighty epochs)
    const activeInf = world.activeInfluences[0] ?? null;
    this.activeInfluencePos = activeInf ? { ...activeInf.position } : null;

    let epochHtml = '';
    if (activeInf) {
      const meta = DIVINE_EVENT_CATALOG[activeInf.type];
      const elapsed = Math.max(0, world.elapsedSeconds - activeInf.startedAt);
      const total = Math.max(1, activeInf.duration);
      const rem = Math.max(0, Math.ceil(activeInf.startedAt + total - world.elapsedSeconds));
      const pctLeft = Math.round(Math.max(0, Math.min(1, 1 - elapsed / total)) * 100);
      const isDisruptive = activeInf.polarity === 'disruptive';
      const polarityLabel = isDisruptive ? 'Upheaval' : 'Renewal';

      const chips: string[] = [];
      if (activeInf.treesAffected > 0) {
        chips.push(isDisruptive ? `🪓 ${activeInf.treesAffected} trees lost` : `🌱 ${activeInf.treesAffected} regrown`);
      }
      if (activeInf.buildingsAffected > 0) {
        chips.push(isDisruptive ? `🏚 ${activeInf.buildingsAffected} battered` : `🏡 ${activeInf.buildingsAffected} aided`);
      }
      if (activeInf.casualties > 0) {
        chips.push(`🕯 ${activeInf.casualties} mourned`);
      }
      if (activeInf.adaptationsTriggered > 0) {
        chips.push(`🛠 ${activeInf.adaptationsTriggered} adapted`);
      }
      if (activeInf.migrationTriggered) {
        chips.push(`🧭 Migration sparked`);
      }
      const chipsHtml = chips.length
        ? `<div class="deity-impact-chips">${chips.map((c) => `<span>${c}</span>`).join('')}</div>`
        : '';

      epochHtml = `
        <div class="deity-epoch-banner polarity-${activeInf.polarity}" title="Click to focus camera on epicenter">
          <div class="deity-epoch-head">
            <span class="deity-epoch-title">${activeInf.icon} ${activeInf.label}</span>
            <span class="deity-polarity-tag">${polarityLabel} · ${rem}s</span>
          </div>
          <div class="deity-epoch-track">
            <div class="deity-epoch-fill" style="width:${pctLeft}%"></div>
          </div>
          <div class="deity-epoch-note">${meta.ecologicalReflection}</div>
          ${chipsHtml}
        </div>
      `;
    }

    // Live Realm Ecology & social status pills (each clickable to focus the map on where it's happening)
    const social = d.getSocialClimate(world);
    this.lastSocialTone = social.tone;
    const canFocusAny =
      Boolean(this.onFocusPosition) &&
      (world.settlements.length > 0 ||
        world.activeInfluences.length > 0 ||
        world.activeDivineEffects.length > 0 ||
        world.habitatScars.length > 0 ||
        this.lastConditionPositions.size > 0);
    const ecoChips: string[] = [];
    const pushChip = (key: string, toneClass: string, label: string) => {
      if (canFocusAny) {
        ecoChips.push(
          `<button type="button" class="eco-chip ${toneClass} clickable" data-eco-key="${key}" title="Click to view on map (click again to cycle sites)">${label}</button>`,
        );
      } else {
        ecoChips.push(`<span class="eco-chip ${toneClass}">${label}</span>`);
      }
    };

    let hasEcoCondition = false;
    if (world.floodSurge > 0.08) {
      pushChip('flood', 'warn', `🌊 Flood +${world.floodSurge.toFixed(1)}m`);
      hasEcoCondition = true;
    }
    if (world.climateHeat > 0.12) {
      pushChip('heatwave', 'warn', `🔥 Heatwave ${Math.round(world.climateHeat * 100)}%`);
      hasEcoCondition = true;
    }
    if (world.climateFreeze > 0.12) {
      pushChip('freeze', 'warn', `❄️ Deep Freeze ${Math.round(world.climateFreeze * 100)}%`);
      hasEcoCondition = true;
    }
    if (world.miasmaIntensity > 0.12) {
      pushChip('miasma', 'warn', `🌫 Ashen Pall ${Math.round(world.miasmaIntensity * 100)}%`);
      hasEcoCondition = true;
    }
    if (world.habitatScars.length > 0) {
      pushChip(
        'scars',
        'warn',
        `🪓 ${world.habitatScars.length} Cleared Scar${world.habitatScars.length > 1 ? 's' : ''}`,
      );
      hasEcoCondition = true;
    }
    if (world.rewildingBoost > 0.12) {
      pushChip('rewilding', 'heal', '🌱 Rewilding');
      hasEcoCondition = true;
    }
    if (!hasEcoCondition) {
      pushChip('balance', 'calm', '🌿 Natural Balance');
    }

    // Live creature social climate & diplomatic pulse driven by deity alignment
    const socialChipClass =
      social.tone === 'good'
        ? 'heal'
        : social.tone === 'bad'
          ? 'bad'
          : social.tone === 'warn'
            ? 'warn'
            : 'calm';
    pushChip('social', socialChipClass, `${social.icon} ${social.label}`);

    const diploCounts = world.diplomacy.getRealmCounts(world.settlements);
    if (diploCounts.wars > 0) {
      pushChip(
        'wars',
        'bad',
        `⚔️ ${diploCounts.wars} Border War${diploCounts.wars > 1 ? 's' : ''}`,
      );
    } else if (diploCounts.alliances > 0) {
      pushChip(
        'alliances',
        'heal',
        `🤝 ${diploCounts.alliances} Alliance${diploCounts.alliances > 1 ? 's' : ''}`,
      );
    }

    const bar = (label: string, val: number, color: string) => `
      <div class="stat-bar">
        <div class="stat-bar-head"><span>${label}</span><span>${Math.round(val * 100)}%</span></div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round(val * 100)}%;background:${color}"></div></div>
      </div>
    `;

    const nextBodyHtml = `
      <div class="deity-name">${d.name} <small>${d.epithet}</small></div>
      <div class="deity-aspect">${d.aspect}</div>
      <div class="deity-meta">
        <span>Energy: <strong>${Math.round(d.energy)}%</strong></span>
        <span>Favored: <strong>${favored}</strong></span>
      </div>
      <div class="deity-bars">
        ${bar('Benevolence', d.traits.benevolence, '#6ad48a')}
        ${bar('Verdancy', d.traits.verdancy, '#49b879')}
        ${bar('Curiosity', d.traits.curiosity, '#69b8e8')}
        ${bar('Chaos', d.traits.chaos, '#e5a44d')}
        ${bar('Wrath', d.traits.wrath, '#e06258')}
      </div>
    `;
    if (nextBodyHtml !== this.lastBodyHtml) {
      this.lastBodyHtml = nextBodyHtml;
      this.bodyEl.innerHTML = nextBodyHtml;
    }

    const nextStatusHtml = `
      <div class="deity-ecology-strip">${ecoChips.join('')}</div>
      ${epochHtml}
      <div class="deity-omen">“${d.lastOmen}”</div>
    `;
    if (nextStatusHtml !== this.lastStatusHtml) {
      this.lastStatusHtml = nextStatusHtml;
      this.statusEl.innerHTML = nextStatusHtml;
    }

    const cooling = d.whisperCooldown > 0.5;
    if (cooling !== this.lastCooling) {
      this.lastCooling = cooling;
      for (const btn of this.whisperButtons) {
        btn.disabled = cooling;
      }
    }
    if (d.stance !== this.lastStance) {
      this.lastStance = d.stance;
      for (const [stance, btn] of this.stanceButtons.entries()) {
        const active = d.stance === stance;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }
    if (!cooling && this.feedbackEl.textContent === '') {
      this.feedbackEl.textContent = 'Steer the unseen hand or invoke an act...';
    }
  }
}
