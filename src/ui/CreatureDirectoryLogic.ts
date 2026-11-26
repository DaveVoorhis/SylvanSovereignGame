import type {
  CreatureActivity,
  CreatureRole,
  LifeStage,
  SpeciesId,
} from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import type { Settlement } from '@simulation/settlements/Settlement';

export type CreatureSortKey =
  | 'name'
  | 'species'
  | 'lineage'
  | 'generation'
  | 'age'
  | 'lifeStage'
  | 'village'
  | 'role'
  | 'activity'
  | 'mood'
  | 'health'
  | 'wealth'
  | 'offspring';

export type SortDirection = 'asc' | 'desc';

export type LineageSortKey = 'size' | 'depth' | 'living' | 'species' | 'founder';

export interface CreatureFilterState {
  search: string;
  species: SpeciesId | 'all';
  settlementId: string | 'all';
  lifeStage: LifeStage | 'all';
  includeFallen: boolean;
}

export interface CreatureDirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly firstName: string;
  readonly surname: string;
  readonly species: SpeciesId;
  readonly speciesName: string;
  readonly speciesColorHex: string;
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColorHex: string;
  readonly role: CreatureRole;
  readonly roleLabel: string;
  readonly activity: CreatureActivity;
  readonly activityLabel: string;
  readonly ageDays: number;
  readonly lifespanDays: number;
  readonly lifeStage: LifeStage;
  readonly lifeStageLabel: string;
  readonly alive: boolean;
  readonly generation: number;
  readonly lineageId: string;
  readonly lineageName: string;
  readonly lineageSize: number;
  readonly lineageMaxGen: number;
  readonly mateId: string | null;
  readonly mateName: string | null;
  readonly mateLineageId: string | null;
  readonly mateLineageName: string | null;
  readonly parentIds: readonly string[];
  readonly parentNames: readonly string[];
  readonly litterId: string | null;
  readonly offspringIds: readonly string[];
  readonly offspringCount: number;
  readonly livingOffspringCount: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly healthPct: number;
  readonly mood: number;
  readonly energy: number;
  readonly devotion: number;
  readonly wealth: number;
  readonly friendCount: number;
  readonly thought: string;
}

export interface FamilyTreeNode {
  readonly primary: CreatureDirectoryEntry;
  readonly mate: CreatureDirectoryEntry | null;
  readonly mateIsCrossLineage: boolean;
  readonly children: FamilyTreeNode[];
  readonly generation: number;
}

export interface LineageSpeciesCount {
  readonly species: SpeciesId;
  readonly name: string;
  readonly colorHex: string;
  readonly count: number;
}

export interface LineageFamilyTree {
  readonly lineageId: string;
  readonly lineageName: string;
  readonly root: FamilyTreeNode;
  readonly primarySpecies: SpeciesId;
  readonly primarySpeciesName: string;
  readonly primarySpeciesColorHex: string;
  readonly speciesList: LineageSpeciesCount[];
  readonly settlementIds: string[];
  readonly settlementNames: string[];
  readonly memberIds: Set<string>;
  readonly totalMembers: number;
  readonly livingMembers: number;
  readonly fallenMembers: number;
  readonly maxGeneration: number;
  readonly hasFamilyBonds: boolean;
}

export interface CreatureDirectorySnapshot {
  readonly entries: CreatureDirectoryEntry[];
  readonly entriesById: Map<string, CreatureDirectoryEntry>;
  readonly trees: LineageFamilyTree[];
  readonly treesByLineageId: Map<string, LineageFamilyTree>;
  readonly totalLiving: number;
  readonly totalFallen: number;
  readonly speciesCount: number;
  readonly maxGeneration: number;
  readonly familyLineCount: number;
}

const LIFE_STAGE_ORDER: Record<LifeStage, number> = {
  young: 0,
  juvenile: 1,
  adult: 2,
  elder: 3,
};

function toHexColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function extractFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || fullName;
}

export function extractFamilySurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : fullName.trim();
}

function formatRoleLabel(role: CreatureRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatActivityLabel(activity: CreatureActivity, alive: boolean): string {
  if (!alive) return 'Fallen';
  const spaced = activity.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatLifeStageLabel(creature: Creature): string {
  if (!creature.alive) return 'Fallen';
  if (creature.lifeStage === 'young') {
    const young = creature.def.youngSingular;
    return young.charAt(0).toUpperCase() + young.slice(1);
  }
  return creature.lifeStage.charAt(0).toUpperCase() + creature.lifeStage.slice(1);
}

interface FounderGroup {
  readonly primaryId: string;
  readonly partnerId: string | null;
  lineageName: string;
}

/**
 * Builds the full creature census and genealogical family-tree forest from the
 * current world state, preserving deceased ancestors so multi-generation
 * lineages remain unbroken.
 */
export function buildCreatureDirectorySnapshot(
  creatures: readonly Creature[],
  settlements: readonly Settlement[],
): CreatureDirectorySnapshot {
  const byId = new Map<string, Creature>();
  for (const c of creatures) {
    byId.set(c.id, c);
  }

  // Build bidirectional offspring lookup merging explicit offspringIds with reverse parentIds links
  const offspringSetById = new Map<string, Set<string>>();
  const addOffspringLink = (parentId: string, childId: string): void => {
    if (parentId === childId) return;
    let set = offspringSetById.get(parentId);
    if (!set) {
      set = new Set<string>();
      offspringSetById.set(parentId, set);
    }
    set.add(childId);
  };
  for (const c of creatures) {
    for (const oid of c.offspringIds) {
      addOffspringLink(c.id, oid);
    }
    for (const pid of c.parentIds) {
      addOffspringLink(pid, c.id);
    }
  }

  const settlementMap = new Map<string, Settlement>();
  for (const s of settlements) {
    settlementMap.set(s.id, s);
  }

  // 1. Identify root founders (creatures without known parents in the world)
  const isRootFounder = (c: Creature): boolean =>
    c.parentIds.every((pid) => !byId.has(pid));

  const rootFounders = creatures.filter(isRootFounder);
  const rootFounderIds = new Set(rootFounders.map((c) => c.id));

  // Pair root founders who are mates or share offspring into a single founder couple
  const founderGroupByMember = new Map<string, FounderGroup>();
  const founderGroups: FounderGroup[] = [];

  const sortedRootFounders = [...rootFounders].sort((a, b) => {
    if (b.offspringIds.length !== a.offspringIds.length) {
      return b.offspringIds.length - a.offspringIds.length;
    }
    if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
    return a.id.localeCompare(b.id);
  });

  const findRootCoParent = (founder: Creature): Creature | null => {
    if (founder.mateId && rootFounderIds.has(founder.mateId)) {
      const mate = byId.get(founder.mateId);
      if (mate && !founderGroupByMember.has(mate.id) && mate.id !== founder.id) {
        return mate;
      }
    }
    for (const childId of founder.offspringIds) {
      const child = byId.get(childId);
      if (!child) continue;
      for (const pid of child.parentIds) {
        if (pid !== founder.id && rootFounderIds.has(pid) && !founderGroupByMember.has(pid)) {
          const coParent = byId.get(pid);
          if (coParent) return coParent;
        }
      }
    }
    return null;
  };

  for (const founder of sortedRootFounders) {
    if (founderGroupByMember.has(founder.id)) continue;
    const partner = findRootCoParent(founder);
    let primary = founder;
    let secondary = partner;

    if (secondary) {
      // Pick the primary founder whose surname matches the most shared offspring, else older/id
      const founderSurname = extractFamilySurname(founder.name);
      const partnerSurname = extractFamilySurname(secondary.name);
      let founderMatches = 0;
      let partnerMatches = 0;
      for (const oid of founder.offspringIds) {
        const child = byId.get(oid);
        if (!child) continue;
        const cs = extractFamilySurname(child.name);
        if (cs === founderSurname) founderMatches++;
        if (cs === partnerSurname) partnerMatches++;
      }
      if (
        partnerMatches > founderMatches ||
        (partnerMatches === founderMatches && secondary.id.localeCompare(founder.id) < 0)
      ) {
        primary = secondary;
        secondary = founder;
      }
    }

    const baseSurname = extractFamilySurname(primary.name);
    const group: FounderGroup = {
      primaryId: primary.id,
      partnerId: secondary ? secondary.id : null,
      lineageName: `${baseSurname} Line`,
    };
    founderGroups.push(group);
    founderGroupByMember.set(primary.id, group);
    if (secondary) {
      founderGroupByMember.set(secondary.id, group);
    }
  }

  // Disambiguate unrelated founder lines that share the same surname
  const surnameUsage = new Map<string, FounderGroup[]>();
  for (const group of founderGroups) {
    const primary = byId.get(group.primaryId);
    if (!primary) continue;
    const surname = extractFamilySurname(primary.name);
    const list = surnameUsage.get(surname) ?? [];
    list.push(group);
    surnameUsage.set(surname, list);
  }
  for (const [surname, groups] of surnameUsage) {
    if (groups.length <= 1) continue;
    for (const group of groups) {
      const primary = byId.get(group.primaryId);
      if (!primary) continue;
      group.lineageName = `${surname} (${extractFirstName(primary.name)})`;
    }
  }

  // 2. Assign every creature to a canonical founding lineage (cycle-safe)
  const lineageIdByCreature = new Map<string, string>();

  const resolveLineageId = (creatureId: string, visiting: Set<string>): string => {
    const cached = lineageIdByCreature.get(creatureId);
    if (cached) return cached;

    const fg = founderGroupByMember.get(creatureId);
    if (fg) {
      lineageIdByCreature.set(creatureId, fg.primaryId);
      return fg.primaryId;
    }

    const creature = byId.get(creatureId);
    if (!creature || visiting.has(creatureId)) {
      return creatureId;
    }
    visiting.add(creatureId);

    const validParents = creature.parentIds
      .map((pid) => byId.get(pid))
      .filter((p): p is Creature => Boolean(p));

    if (validParents.length === 0) {
      visiting.delete(creatureId);
      lineageIdByCreature.set(creatureId, creatureId);
      return creatureId;
    }

    // Prefer the parent whose surname matches this creature's inherited surname
    const mySurname = extractFamilySurname(creature.name);
    const surnameParent = validParents.find((p) => extractFamilySurname(p.name) === mySurname);
    const chosenParent = surnameParent ?? validParents[0];
    const resolved = resolveLineageId(chosenParent.id, visiting);

    visiting.delete(creatureId);
    lineageIdByCreature.set(creatureId, resolved);
    return resolved;
  };

  for (const c of creatures) {
    resolveLineageId(c.id, new Set());
  }

  // Ensure every lineageId has a FounderGroup entry (defensive fallback for cyclic/synthetic data)
  const founderGroupById = new Map<string, FounderGroup>();
  for (const g of founderGroups) {
    founderGroupById.set(g.primaryId, g);
  }
  for (const c of creatures) {
    const lid = lineageIdByCreature.get(c.id) ?? c.id;
    if (!founderGroupById.has(lid)) {
      const rootCreature = byId.get(lid) ?? c;
      const fallback: FounderGroup = {
        primaryId: lid,
        partnerId: null,
        lineageName: `${extractFamilySurname(rootCreature.name)} Line`,
      };
      founderGroups.push(fallback);
      founderGroupById.set(lid, fallback);
    }
  }

  // 3. Aggregate per-lineage stats
  const lineageMembersMap = new Map<string, Creature[]>();
  for (const c of creatures) {
    const lid = lineageIdByCreature.get(c.id) ?? c.id;
    const list = lineageMembersMap.get(lid) ?? [];
    list.push(c);
    lineageMembersMap.set(lid, list);
  }

  const lineageStats = new Map<string, { size: number; maxGen: number }>();
  for (const [lid, members] of lineageMembersMap) {
    let maxGen = 1;
    for (const m of members) {
      if (m.generation > maxGen) maxGen = m.generation;
    }
    lineageStats.set(lid, { size: members.length, maxGen });
  }

  // 4. Construct CreatureDirectoryEntry records
  const entries: CreatureDirectoryEntry[] = [];
  const entriesById = new Map<string, CreatureDirectoryEntry>();
  const speciesSet = new Set<SpeciesId>();
  let totalLiving = 0;
  let totalFallen = 0;
  let globalMaxGen = 1;

  for (const c of creatures) {
    const settlement = settlementMap.get(c.settlementId);
    const lid = lineageIdByCreature.get(c.id) ?? c.id;
    const group = founderGroupById.get(lid)!;
    const stats = lineageStats.get(lid) ?? { size: 1, maxGen: c.generation };
    const mate = c.mateId ? byId.get(c.mateId) : undefined;
    const mateLid = mate ? (lineageIdByCreature.get(mate.id) ?? mate.id) : null;
    const mateGroup = mateLid ? founderGroupById.get(mateLid) : undefined;

    const parentNames = c.parentIds
      .map((pid) => byId.get(pid)?.name)
      .filter((n): n is string => Boolean(n));

    const mergedOffspringIds = Array.from(offspringSetById.get(c.id) ?? []);
    let livingOffspringCount = 0;
    for (const oid of mergedOffspringIds) {
      if (byId.get(oid)?.alive) livingOffspringCount++;
    }

    if (c.alive) {
      totalLiving++;
      speciesSet.add(c.species);
    } else {
      totalFallen++;
    }
    if (c.generation > globalMaxGen) globalMaxGen = c.generation;

    const entry: CreatureDirectoryEntry = {
      id: c.id,
      name: c.name,
      firstName: extractFirstName(c.name),
      surname: extractFamilySurname(c.name),
      species: c.species,
      speciesName: c.def.displayName,
      speciesColorHex: toHexColor(c.def.primaryColor),
      settlementId: c.settlementId,
      settlementName: settlement?.name ?? 'Wanderer',
      settlementColorHex: settlement ? toHexColor(settlement.bannerColor) : '#8da592',
      role: c.role,
      roleLabel: formatRoleLabel(c.role),
      activity: c.activity,
      activityLabel: formatActivityLabel(c.activity, c.alive),
      ageDays: c.ageDays,
      lifespanDays: c.lifespanDays,
      lifeStage: c.lifeStage,
      lifeStageLabel: formatLifeStageLabel(c),
      alive: c.alive,
      generation: c.generation,
      lineageId: lid,
      lineageName: group.lineageName,
      lineageSize: stats.size,
      lineageMaxGen: stats.maxGen,
      mateId: mate ? mate.id : null,
      mateName: mate ? mate.name : null,
      mateLineageId: mateLid,
      mateLineageName: mateGroup ? mateGroup.lineageName : null,
      parentIds: [...c.parentIds],
      parentNames,
      litterId: c.litterId,
      offspringIds: mergedOffspringIds,
      offspringCount: mergedOffspringIds.length,
      livingOffspringCount,
      health: c.health,
      maxHealth: c.maxHealth,
      healthPct: c.maxHealth > 0 ? Math.max(0, Math.min(100, (c.health / c.maxHealth) * 100)) : 0,
      mood: c.mood,
      energy: c.energy,
      devotion: c.devotion,
      wealth: c.wealth,
      friendCount: c.getFriendCount(),
      thought: c.thought,
    };

    entries.push(entry);
    entriesById.set(entry.id, entry);
  }

  // 5. Build genealogical Family Trees per founding lineage
  const trees: LineageFamilyTree[] = [];
  const treesByLineageId = new Map<string, LineageFamilyTree>();

  const sortChildren = (a: CreatureDirectoryEntry, b: CreatureDirectoryEntry): number => {
    if (Math.abs(b.ageDays - a.ageDays) > 0.001) return b.ageDays - a.ageDays;
    if ((a.litterId ?? '') !== (b.litterId ?? '')) {
      return (a.litterId ?? '').localeCompare(b.litterId ?? '');
    }
    return a.name.localeCompare(b.name);
  };

  for (const group of founderGroups) {
    const members = lineageMembersMap.get(group.primaryId);
    if (!members || members.length === 0) continue;

    const rootEntry = entriesById.get(group.primaryId);
    if (!rootEntry) continue;

    const placedInLineage = new Set<string>();
    const lineageMemberEntries = members
      .map((m) => entriesById.get(m.id))
      .filter((e): e is CreatureDirectoryEntry => Boolean(e));

    const buildNode = (
      primary: CreatureDirectoryEntry,
      forcedPartnerId: string | null,
    ): FamilyTreeNode => {
      placedInLineage.add(primary.id);

      let mate: CreatureDirectoryEntry | null = null;
      let mateIsCrossLineage = false;

      const candidateMateId = forcedPartnerId ?? primary.mateId;
      if (candidateMateId && candidateMateId !== primary.id) {
        const candidateMate = entriesById.get(candidateMateId);
        if (candidateMate) {
          if (candidateMate.lineageId === group.primaryId) {
            if (!placedInLineage.has(candidateMate.id)) {
              mate = candidateMate;
              placedInLineage.add(candidateMate.id);
            }
          } else {
            // Married in from another bloodline: display alongside primary without stealing them
            mate = candidateMate;
            mateIsCrossLineage = true;
          }
        }
      }

      // Collect direct children that belong to this lineage and have primary (or same-lineage mate) as parent
      const childCandidates: CreatureDirectoryEntry[] = [];
      for (const candidate of lineageMemberEntries) {
        if (placedInLineage.has(candidate.id)) continue;
        const hasPrimaryParent = candidate.parentIds.includes(primary.id);
        const hasSameLineageMateParent =
          mate !== null && !mateIsCrossLineage && candidate.parentIds.includes(mate.id);
        if (hasPrimaryParent || hasSameLineageMateParent) {
          childCandidates.push(candidate);
        }
      }

      childCandidates.sort(sortChildren);

      // Reserve children immediately before recursing so siblings never steal each other
      for (const ch of childCandidates) {
        placedInLineage.add(ch.id);
      }

      const children: FamilyTreeNode[] = childCandidates.map((ch) => buildNode(ch, null));

      return {
        primary,
        mate,
        mateIsCrossLineage,
        children,
        generation: primary.generation,
      };
    };

    const rootNode = buildNode(rootEntry, group.partnerId);

    // Defensive check: attach any unplaced lineage member (e.g. if an intermediate ancestor was missing)
    const remaining = lineageMemberEntries
      .filter((e) => !placedInLineage.has(e.id))
      .sort(sortChildren);
    for (const orphan of remaining) {
      if (placedInLineage.has(orphan.id)) continue;
      rootNode.children.push(buildNode(orphan, null));
    }

    const memberIds = new Set<string>();
    const speciesCountMap = new Map<SpeciesId, LineageSpeciesCount>();
    const settlementIdSet = new Set<string>();
    const settlementNameSet = new Set<string>();
    let livingMembers = 0;
    let fallenMembers = 0;
    let maxGeneration = 1;

    for (const m of lineageMemberEntries) {
      memberIds.add(m.id);
      if (m.alive) livingMembers++;
      else fallenMembers++;
      if (m.generation > maxGeneration) maxGeneration = m.generation;
      settlementIdSet.add(m.settlementId);
      settlementNameSet.add(m.settlementName);

      const prev = speciesCountMap.get(m.species);
      if (prev) {
        speciesCountMap.set(m.species, { ...prev, count: prev.count + 1 });
      } else {
        speciesCountMap.set(m.species, {
          species: m.species,
          name: m.speciesName,
          colorHex: m.speciesColorHex,
          count: 1,
        });
      }
    }

    const speciesList = [...speciesCountMap.values()].sort((a, b) => b.count - a.count);

    const tree: LineageFamilyTree = {
      lineageId: group.primaryId,
      lineageName: group.lineageName,
      root: rootNode,
      primarySpecies: rootEntry.species,
      primarySpeciesName: rootEntry.speciesName,
      primarySpeciesColorHex: rootEntry.speciesColorHex,
      speciesList,
      settlementIds: [...settlementIdSet],
      settlementNames: [...settlementNameSet],
      memberIds,
      totalMembers: lineageMemberEntries.length,
      livingMembers,
      fallenMembers,
      maxGeneration,
      hasFamilyBonds:
        lineageMemberEntries.length > 1 || rootNode.mate !== null || rootNode.children.length > 0,
    };

    trees.push(tree);
    treesByLineageId.set(tree.lineageId, tree);
  }

  return {
    entries,
    entriesById,
    trees,
    treesByLineageId,
    totalLiving,
    totalFallen,
    speciesCount: speciesSet.size,
    maxGeneration: globalMaxGen,
    familyLineCount: trees.length,
  };
}

/** Filters creature entries by search query, species, village, life stage, and fallen toggle. */
export function filterCreatureEntries(
  entries: readonly CreatureDirectoryEntry[],
  filter: CreatureFilterState,
): CreatureDirectoryEntry[] {
  const q = filter.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!filter.includeFallen && !entry.alive) return false;
    if (filter.species !== 'all' && entry.species !== filter.species) return false;
    if (filter.settlementId !== 'all' && entry.settlementId !== filter.settlementId) return false;
    if (filter.lifeStage !== 'all' && entry.lifeStage !== filter.lifeStage) return false;
    if (q.length > 0) {
      const haystack =
        `${entry.name} ${entry.speciesName} ${entry.lineageName} ${entry.settlementName} ${entry.roleLabel} ${entry.activityLabel} ${entry.lifeStageLabel}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Sorts creature entries by any supported column with deterministic tie-breakers. */
export function sortCreatureEntries(
  entries: readonly CreatureDirectoryEntry[],
  sortKey: CreatureSortKey,
  sortDir: SortDirection,
): CreatureDirectoryEntry[] {
  const mult = sortDir === 'asc' ? 1 : -1;

  return [...entries].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'species':
        cmp = a.speciesName.localeCompare(b.speciesName) || a.name.localeCompare(b.name);
        break;
      case 'lineage':
        cmp =
          a.lineageName.localeCompare(b.lineageName) ||
          a.generation - b.generation ||
          b.ageDays - a.ageDays ||
          a.name.localeCompare(b.name);
        break;
      case 'generation':
        cmp =
          a.generation - b.generation ||
          a.lineageName.localeCompare(b.lineageName) ||
          a.name.localeCompare(b.name);
        break;
      case 'age':
        cmp = a.ageDays - b.ageDays;
        break;
      case 'lifeStage':
        cmp = LIFE_STAGE_ORDER[a.lifeStage] - LIFE_STAGE_ORDER[b.lifeStage] || a.ageDays - b.ageDays;
        break;
      case 'village':
        cmp = a.settlementName.localeCompare(b.settlementName) || a.name.localeCompare(b.name);
        break;
      case 'role':
        cmp = a.roleLabel.localeCompare(b.roleLabel) || a.name.localeCompare(b.name);
        break;
      case 'activity':
        cmp = a.activityLabel.localeCompare(b.activityLabel) || a.name.localeCompare(b.name);
        break;
      case 'mood':
        cmp = a.mood - b.mood;
        break;
      case 'health':
        cmp = a.healthPct - b.healthPct;
        break;
      case 'wealth':
        cmp = a.wealth - b.wealth;
        break;
      case 'offspring':
        cmp = a.offspringCount - b.offspringCount || a.livingOffspringCount - b.livingOffspringCount;
        break;
    }

    if (cmp !== 0) return cmp * mult;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

function treeContainsMatch(
  node: FamilyTreeNode,
  predicate: (entry: CreatureDirectoryEntry) => boolean,
): boolean {
  if (predicate(node.primary)) return true;
  if (node.mate && predicate(node.mate)) return true;
  for (const ch of node.children) {
    if (treeContainsMatch(ch, predicate)) return true;
  }
  return false;
}

/** Filters family trees to those containing at least one creature matching the active filters. */
export function filterLineageTrees(
  trees: readonly LineageFamilyTree[],
  filter: CreatureFilterState,
): LineageFamilyTree[] {
  const q = filter.search.trim().toLowerCase();
  return trees.filter((tree) => {
    if (!filter.includeFallen && tree.livingMembers === 0) return false;
    if (
      filter.species !== 'all' &&
      !tree.speciesList.some((sp) => sp.species === filter.species)
    ) {
      return false;
    }
    if (
      filter.settlementId !== 'all' &&
      !tree.settlementIds.includes(filter.settlementId)
    ) {
      return false;
    }

    const matchesNode = (entry: CreatureDirectoryEntry): boolean => {
      if (!filter.includeFallen && !entry.alive) return false;
      if (filter.species !== 'all' && entry.species !== filter.species) return false;
      if (filter.settlementId !== 'all' && entry.settlementId !== filter.settlementId) return false;
      if (filter.lifeStage !== 'all' && entry.lifeStage !== filter.lifeStage) return false;
      if (q.length > 0) {
        const haystack =
          `${entry.name} ${entry.speciesName} ${entry.lineageName} ${entry.settlementName} ${entry.roleLabel} ${entry.lifeStageLabel}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    };

    if (q.length > 0 && tree.lineageName.toLowerCase().includes(q)) {
      if (filter.lifeStage === 'all') return true;
    }

    return treeContainsMatch(tree.root, matchesNode);
  });
}

/** Sorts family trees by bloodline size, generation depth, living kin, species, or founder name. */
export function sortLineageTrees(
  trees: readonly LineageFamilyTree[],
  sortKey: LineageSortKey,
  sortDir: SortDirection,
): LineageFamilyTree[] {
  const mult = sortDir === 'asc' ? 1 : -1;

  return [...trees].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'size':
        cmp =
          a.totalMembers - b.totalMembers ||
          a.maxGeneration - b.maxGeneration ||
          a.livingMembers - b.livingMembers;
        break;
      case 'depth':
        cmp =
          a.maxGeneration - b.maxGeneration ||
          a.totalMembers - b.totalMembers ||
          a.livingMembers - b.livingMembers;
        break;
      case 'living':
        cmp = a.livingMembers - b.livingMembers || a.totalMembers - b.totalMembers;
        break;
      case 'species':
        cmp =
          a.primarySpeciesName.localeCompare(b.primarySpeciesName) ||
          b.totalMembers - a.totalMembers ||
          a.lineageName.localeCompare(b.lineageName);
        break;
      case 'founder':
        cmp = a.lineageName.localeCompare(b.lineageName);
        break;
    }

    if (cmp !== 0) return cmp * mult;
    return a.lineageName.localeCompare(b.lineageName) || a.lineageId.localeCompare(b.lineageId);
  });
}

/**
 * Computes the direct ancestry and descendant creature IDs for a focused
 * creature within a family tree, enabling path highlighting in the tree UI.
 */
export function collectLineageHighlightIds(
  tree: LineageFamilyTree,
  focusedCreatureId: string,
): Set<string> {
  const highlighted = new Set<string>();

  const collectDescendants = (node: FamilyTreeNode): void => {
    highlighted.add(node.primary.id);
    if (node.mate) highlighted.add(node.mate.id);
    for (const ch of node.children) {
      collectDescendants(ch);
    }
  };

  const dfs = (node: FamilyTreeNode): boolean => {
    const isSelf =
      node.primary.id === focusedCreatureId || node.mate?.id === focusedCreatureId;
    if (isSelf) {
      collectDescendants(node);
      return true;
    }
    let foundInChild = false;
    for (const ch of node.children) {
      if (dfs(ch)) {
        foundInChild = true;
      }
    }
    if (foundInChild) {
      highlighted.add(node.primary.id);
      if (node.mate) highlighted.add(node.mate.id);
    }
    return foundInChild;
  };

  dfs(tree.root);
  return highlighted;
}
