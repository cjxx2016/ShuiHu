import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameEngine } from './engine/GameEngine';
import { AREAS, getNpcDialogue } from './game/worldData';
import {
  applyDialogueEffect,
  createInitialQuestFlags,
  getActiveObjective,
  getCharacterIdentity,
  onAreaEntered,
} from './game/questEngine';
import type {
  AreaId,
  DialogueChoice,
  DialogueNode,
  GameMode,
  MinimapSnapshot,
  NearbyInteraction,
  PropActionDef,
  QuestFlags,
  TimeOfDay,
} from './types/world';
import { TitleScreen } from './components/TitleScreen';
import { GameHud } from './components/GameHud';
import { DialogueModal } from './components/DialogueModal';
import { WorldAtlasModal } from './components/WorldAtlasModal';
import { PauseVictoryModal } from './components/PauseVictoryModal';

const TIME_SEQUENCE: TimeOfDay[] = ['dawn', 'noon', 'sunset', 'night'];

function getInitialQueryParams(): { autostart: boolean; initialArea: AreaId } {
  const params = new URLSearchParams(window.location.search);
  const autostart = params.get('autostart') === '1';
  const rawArea = params.get('area') as AreaId | null;
  const initialArea: AreaId = rawArea && AREAS[rawArea] ? rawArea : 'weizhou_region';
  return { autostart, initialArea };
}

export const App: React.FC = () => {
  const initQuery = useMemo(() => getInitialQueryParams(), []);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameMode, setGameMode] = useState<GameMode>(initQuery.autostart ? 'playing' : 'title');
  const [currentArea, setCurrentArea] = useState<AreaId>(initQuery.initialArea);
  const [visitedAreas, setVisitedAreas] = useState<Set<AreaId>>(
    () => new Set([initQuery.initialArea])
  );
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(AREAS[initQuery.initialArea].defaultTime);
  const [questFlags, setQuestFlags] = useState<QuestFlags>(() => createInitialQuestFlags());
  const [nearby, setNearby] = useState<NearbyInteraction | null>(null);
  const [activeDialogue, setActiveDialogue] = useState<DialogueNode | null>(null);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [minimap, setMinimap] = useState<MinimapSnapshot | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const flagsRef = useRef(questFlags);
  flagsRef.current = questFlags;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const objective = useMemo(() => getActiveObjective(questFlags), [questFlags]);
  const identity = useMemo(() => getCharacterIdentity(questFlags), [questFlags]);

  // Mirror state machine to document.body.dataset
  useEffect(() => {
    document.body.dataset.state = gameMode;
    document.body.dataset.area = currentArea;
    engineRef.current?.setGameMode(activeDialogue || atlasOpen ? 'paused' : gameMode);
  }, [gameMode, currentArea, activeDialogue, atlasOpen]);

  // Sync quest flags to Three.js engine (for monk visual transform & knocked-down NPCs)
  useEffect(() => {
    engineRef.current?.setQuestFlags(questFlags);
  }, [questFlags]);

  const handlePropAction = useCallback(
    (prop: PropActionDef) => {
      const flags = flagsRef.current;
      if (prop.actionType === 'drink_wine') {
        const eff = currentArea === 'wutai_region' ? 'buy_mountain_wine' : 'drink_tavern_wine';
        const res = applyDialogueEffect(flags, eff);
        setQuestFlags(res.nextFlags);
        if (res.toast) showToast(res.toast);
        if (res.triggerAction) engineRef.current?.triggerDramaticAction(res.triggerAction);
      } else if (prop.actionType === 'confront_zheng') {
        const res = applyDialogueEffect(flags, 'fight_zhengtu');
        setQuestFlags(res.nextFlags);
        if (res.toast) showToast(res.toast);
        engineRef.current?.triggerDramaticAction('punch');
      } else if (prop.actionType === 'strike_guardian') {
        setQuestFlags((prev) => ({ ...prev, shookMountainGate: true }));
        showToast('醉打山门！金刚泥塑震颤落灰，快入大雄宝殿面见智真长老！');
      } else if (prop.actionType === 'offer_incense') {
        engineRef.current?.triggerDramaticAction('gong');
        showToast('焚香礼佛，青烟袅袅升起，心神澄澈。');
      } else if (prop.actionType === 'uproot_willow') {
        const wasCompleted = flags.uprootedWillow;
        const res = applyDialogueEffect(flags, 'uproot_willow_action');
        setQuestFlags(res.nextFlags);
        if (res.toast) showToast(res.toast);
        engineRef.current?.triggerDramaticAction('willow');
        if (!wasCompleted) {
          window.setTimeout(() => {
            setGameMode('gameover');
          }, 1300);
        }
      }
    },
    [currentArea, showToast]
  );

  // Store engine callbacks in ref so Three.js WebGL lifecycle mounts strictly ONCE
  const callbacksRef = useRef({
    onNearbyChange: (n: NearbyInteraction | null) => setNearby(n),
    onAreaChanged: (areaId: AreaId, tod: TimeOfDay) => {
      setCurrentArea(areaId);
      setTimeOfDay(tod);
      setVisitedAreas((prev) => {
        const next = new Set(prev);
        next.add(areaId);
        return next;
      });
      setQuestFlags((prev) => onAreaEntered(prev, areaId));
    },
    onInteractNpc: (npcId: string) => {
      const node = getNpcDialogue(npcId, flagsRef.current);
      setActiveDialogue(node);
    },
    onTriggerProp: (prop: PropActionDef) => handlePropAction(prop),
    onMinimapUpdate: (snap: MinimapSnapshot) => setMinimap(snap),
  });
  callbacksRef.current.onTriggerProp = handlePropAction;

  // Mount Three.js engine strictly ONCE
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new GameEngine(mountEl, initQuery.initialArea, flagsRef.current, {
      onNearbyChange: (n) => callbacksRef.current.onNearbyChange(n),
      onAreaChanged: (a, t) => callbacksRef.current.onAreaChanged(a, t),
      onInteractNpc: (id) => callbacksRef.current.onInteractNpc(id),
      onTriggerProp: (p) => callbacksRef.current.onTriggerProp(p),
      onMinimapUpdate: (m) => callbacksRef.current.onMinimapUpdate(m),
    });
    engineRef.current = engine;
    engine.setGameMode(initQuery.autostart ? 'playing' : 'title');

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [initQuery]);

  const handleStartGame = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setAtlasOpen(false);
    setActiveDialogue(null);
    setGameMode('playing');
    document.body.dataset.state = 'playing';
  }, []);

  const handleTravel = useCallback(
    (targetArea: AreaId) => {
      setAtlasOpen(false);
      setActiveDialogue(null);
      setGameMode('playing');
      document.body.dataset.state = 'playing';
      engineRef.current?.loadArea(targetArea, undefined, true);
      showToast(`已抵达「${AREAS[targetArea].name}」`);
    },
    [showToast]
  );

  const handleCycleTime = useCallback(() => {
    const idx = TIME_SEQUENCE.indexOf(timeOfDay);
    const next = TIME_SEQUENCE[(idx + 1) % TIME_SEQUENCE.length];
    setTimeOfDay(next);
    engineRef.current?.setTimeOfDay(next);
  }, [timeOfDay]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (engineRef.current) engineRef.current.sfx.muted = next;
      return next;
    });
  }, []);

  const handleSelectDialogueChoice = useCallback(
    (choice: DialogueChoice) => {
      const wasWillowDone = flagsRef.current.uprootedWillow;
      const res = applyDialogueEffect(flagsRef.current, choice.effect);
      setQuestFlags(res.nextFlags);
      if (res.toast) showToast(res.toast);
      if (res.triggerAction) {
        engineRef.current?.triggerDramaticAction(res.triggerAction);
      }
      setActiveDialogue(null);
      if (choice.effect === 'uproot_willow_action' && !wasWillowDone) {
        window.setTimeout(() => setGameMode('gameover'), 1300);
      }
    },
    [showToast]
  );

  const handleRestart = useCallback(() => {
    const fresh = createInitialQuestFlags();
    setQuestFlags(fresh);
    setVisitedAreas(new Set(['weizhou_region']));
    setActiveDialogue(null);
    setAtlasOpen(false);
    setGameMode('playing');
    engineRef.current?.setQuestFlags(fresh);
    engineRef.current?.loadArea('weizhou_region', undefined, true);
    showToast('已重置剧情，回到渭州郊野官道。');
  }, [showToast]);

  // Global keyboard shortcuts (Enter/Space on Title, M Atlas, T Time, V Mute, Esc/P Pause)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (gameMode === 'title') {
        if ((e.code === 'Enter' || e.code === 'Space') && !atlasOpen) {
          e.preventDefault();
          handleStartGame();
        }
        return;
      }

      if (e.code === 'Escape') {
        if (activeDialogue) {
          setActiveDialogue(null);
        } else if (atlasOpen) {
          setAtlasOpen(false);
        } else if (gameMode === 'playing') {
          setGameMode('paused');
        } else if (gameMode === 'paused') {
          setGameMode('playing');
        }
        return;
      }

      if (activeDialogue) return;

      if (e.code === 'KeyM' && !e.repeat) {
        setAtlasOpen((v) => !v);
      } else if (e.code === 'KeyP' && !e.repeat && !atlasOpen) {
        setGameMode((m) => (m === 'playing' ? 'paused' : m === 'paused' ? 'playing' : m));
      } else if (e.code === 'KeyT' && !e.repeat && !atlasOpen && gameMode === 'playing') {
        if (!AREAS[currentArea].isIndoor) handleCycleTime();
      } else if (e.code === 'KeyV' && !e.repeat) {
        handleToggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameMode, atlasOpen, activeDialogue, currentArea, handleStartGame, handleCycleTime, handleToggleMute]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#161411]">
      {/* Isolated WebGL Viewport Container */}
      <div
        ref={canvasMountRef}
        data-testid="game-viewport"
        className="fixed inset-0 w-full h-full z-0"
      />

      {/* Title Screen */}
      {gameMode === 'title' && !atlasOpen && (
        <TitleScreen onStart={handleStartGame} onOpenAtlas={() => setAtlasOpen(true)} />
      )}

      {/* Active Gameplay HUD */}
      {gameMode === 'playing' && (
        <GameHud
          area={AREAS[currentArea]}
          identity={identity}
          objective={objective}
          timeOfDay={timeOfDay}
          muted={muted}
          nearby={activeDialogue || atlasOpen ? null : nearby}
          toast={toast}
          minimap={minimap}
          onOpenAtlas={() => setAtlasOpen(true)}
          onCycleTime={handleCycleTime}
          onToggleMute={handleToggleMute}
          onPause={() => setGameMode('paused')}
          onInteract={() => engineRef.current?.performInteract()}
          onStrike={() => engineRef.current?.performStrike()}
        />
      )}

      {/* NPC Dialogue Modal */}
      {activeDialogue && (
        <DialogueModal
          node={activeDialogue}
          onSelectChoice={handleSelectDialogueChoice}
          onClose={() => setActiveDialogue(null)}
        />
      )}

      {/* 3-Tier World Atlas (2 Regions / 3 Scenes / 2 Interiors) */}
      {atlasOpen && (
        <WorldAtlasModal
          currentArea={currentArea}
          objective={objective}
          onTravel={handleTravel}
          onClose={() => setAtlasOpen(false)}
        />
      )}

      {/* Pause & Victory Modal */}
      {(gameMode === 'paused' || gameMode === 'gameover') && !atlasOpen && (
        <PauseVictoryModal
          mode={gameMode}
          objective={objective}
          visitedCount={visitedAreas.size}
          onResume={() => setGameMode('playing')}
          onOpenAtlas={() => setAtlasOpen(true)}
          onRestart={handleRestart}
          onReturnTitle={() => setGameMode('title')}
        />
      )}
    </div>
  );
};

export default App;
