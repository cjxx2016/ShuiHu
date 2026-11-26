import React from 'react';
import {
  Map as MapIcon,
  Sun,
  Volume2,
  VolumeX,
  Pause,
  Swords,
  Compass,
} from 'lucide-react';
import type {
  AreaConfig,
  CharacterIdentity,
  MinimapSnapshot,
  NearbyInteraction,
  QuestObjective,
  TimeOfDay,
} from '../types/world';

interface GameHudProps {
  area: AreaConfig;
  identity: CharacterIdentity;
  objective: QuestObjective;
  timeOfDay: TimeOfDay;
  muted: boolean;
  nearby: NearbyInteraction | null;
  toast: string | null;
  minimap: MinimapSnapshot | null;
  onOpenAtlas: () => void;
  onCycleTime: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onInteract: () => void;
  onStrike: () => void;
}

const TIME_LABELS: Record<TimeOfDay, string> = {
  dawn: '清晨',
  noon: '正午',
  sunset: '暮色',
  night: '夜景',
};

export const GameHud: React.FC<GameHudProps> = ({
  area,
  identity,
  objective,
  timeOfDay,
  muted,
  nearby,
  toast,
  minimap,
  onOpenAtlas,
  onCycleTime,
  onToggleMute,
  onPause,
  onInteract,
  onStrike,
}) => {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none select-none">
      {/* Top-Left Cluster: Area Nameplate + Active Quest Objective */}
      <div className="absolute top-4 left-4 flex items-start gap-3 max-w-[min(370px,78vw)]">
        {/* Compact Song Compass Minimap */}
        {minimap && (
          <div
            className="hidden sm:flex shrink-0 w-24 h-24 rounded-full bg-[#171411]/90 border border-[#d4ae62]/45 shadow-lg relative overflow-hidden items-center justify-center"
            aria-label="当前区域小地图"
          >
            <svg viewBox="-50 -50 100 100" className="w-full h-full">
              <circle cx="0" cy="0" r="46" fill="none" stroke="#d4ae62" strokeOpacity="0.22" strokeWidth="1" />
              <line x1="-46" y1="0" x2="46" y2="0" stroke="#d4ae62" strokeOpacity="0.12" strokeWidth="1" />
              <line x1="0" y1="-46" x2="0" y2="46" stroke="#d4ae62" strokeOpacity="0.12" strokeWidth="1" />
              <text x="0" y="-36" textAnchor="middle" fill="#cbb994" fontSize="8" fontFamily="serif">
                北
              </text>
              {minimap.portals.map((p, idx) => {
                const mx = Math.max(-42, Math.min(42, (p.x / minimap.areaSize) * 40));
                const mz = Math.max(-42, Math.min(42, (p.z / minimap.areaSize) * 40));
                return <circle key={`p-${idx}`} cx={mx} cy={mz} r="3.4" fill="#7be092" />;
              })}
              {minimap.npcs.map((n, idx) => {
                const mx = Math.max(-42, Math.min(42, (n.x / minimap.areaSize) * 40));
                const mz = Math.max(-42, Math.min(42, (n.z / minimap.areaSize) * 40));
                return (
                  <circle
                    key={`n-${idx}`}
                    cx={mx}
                    cy={mz}
                    r={n.important ? 2.8 : 1.7}
                    fill={n.important ? '#f5c452' : '#d2c7b2'}
                    fillOpacity={n.important ? 0.95 : 0.65}
                  />
                );
              })}
              {/* Player directional arrow */}
              <g
                transform={`translate(${Math.max(-42, Math.min(42, (minimap.playerX / minimap.areaSize) * 40))}, ${Math.max(-42, Math.min(42, (minimap.playerZ / minimap.areaSize) * 40))}) rotate(${(-minimap.playerYaw * 180) / Math.PI + 180})`}
              >
                <polygon points="0,-5 3.6,4 0,2 -3.6,4" fill="#e5483a" stroke="#fff4dc" strokeWidth="0.8" />
              </g>
            </svg>
          </div>
        )}

        <div className="bg-[#171411]/88 border border-[#d4ae62]/35 rounded-md px-3.5 py-2.5 shadow-lg">
          <div className="flex items-center gap-2 text-xs text-[#d6b164] font-sans-ui">
            <span>{area.tierLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{TIME_LABELS[timeOfDay]}</span>
          </div>
          <h1 className="text-base sm:text-lg font-bold text-[#f9f3e6] tracking-wide leading-snug mt-0.5">
            {area.name}
          </h1>
          <div className="mt-1.5 pt-1.5 border-t border-[#d4ae62]/20">
            <div className="text-xs font-semibold text-[#f1c96b] font-sans-ui">
              {objective.chapterTitle}
            </div>
            <p className="text-xs text-[#ddd3c0] leading-relaxed mt-0.5 font-sans-ui">
              {objective.summary}
            </p>
          </div>
        </div>
      </div>

      {/* Top-Right Cluster: Compact Square Utility Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenAtlas();
          }}
          aria-label="打开水浒舆图 (M)"
          title="水浒舆图 (M)"
          className="h-10 px-3 rounded-md bg-[#171411]/90 hover:bg-[#2a231c] border border-[#d4ae62]/40 text-[#f5ebd6] text-xs font-medium inline-flex items-center gap-1.5 shadow-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <MapIcon className="w-4 h-4 text-[#e5ba60]" aria-hidden="true" />
          <span className="hidden sm:inline font-sans-ui">舆图</span>
          <span className="font-mono-num text-[11px] text-[#cbb996]">[M]</span>
        </button>

        {!area.isIndoor && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleTime();
            }}
            aria-label={`切换时辰，当前${TIME_LABELS[timeOfDay]} (T)`}
            title="切换时辰 (T)"
            className="w-10 h-10 rounded-md bg-[#171411]/90 hover:bg-[#2a231c] border border-[#d4ae62]/40 text-[#f5ebd6] inline-flex items-center justify-center shadow-md transition-colors cursor-pointer shrink-0"
          >
            <Sun className="w-4 h-4 text-[#e5ba60]" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          aria-label={muted ? '取消静音 (V)' : '静音 (V)'}
          title={muted ? '取消静音' : '静音'}
          className="w-10 h-10 rounded-md bg-[#171411]/90 hover:bg-[#2a231c] border border-[#d4ae62]/40 text-[#f5ebd6] inline-flex items-center justify-center shadow-md transition-colors cursor-pointer shrink-0"
        >
          {muted ? (
            <VolumeX className="w-4 h-4 text-[#b8ab96]" aria-hidden="true" />
          ) : (
            <Volume2 className="w-4 h-4 text-[#e5ba60]" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onPause();
          }}
          aria-label="暂停游戏 (Esc)"
          title="暂停 (Esc)"
          className="w-10 h-10 rounded-md bg-[#171411]/90 hover:bg-[#2a231c] border border-[#d4ae62]/40 text-[#f5ebd6] inline-flex items-center justify-center shadow-md transition-colors cursor-pointer shrink-0"
        >
          <Pause className="w-4 h-4 text-[#e5ba60]" aria-hidden="true" />
        </button>
      </div>

      {/* Transient Narrative Toast Notification */}
      {toast && (
        <div
          role="status"
          className="absolute top-20 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-md bg-[#1c1713]/95 border border-[#e3b85e]/65 text-[#fdf5e6] text-sm font-medium shadow-xl max-w-[90vw] text-center font-sans-ui"
        >
          {toast}
        </div>
      )}

      {/* Contextual Bottom-Center Interaction Prompt */}
      {nearby && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              if (nearby.keyHint === 'J') onStrike();
              else onInteract();
            }}
            className="flex items-center gap-3 px-5 py-2.5 rounded-md bg-[#1a1511]/95 hover:bg-[#2b2119] border border-[#e5ba5f]/75 text-[#fbf4e4] shadow-xl transition-colors cursor-pointer whitespace-nowrap"
          >
            <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#a63026] text-[#fff6e5] font-mono-num text-xs font-bold">
              {nearby.keyHint}
            </span>
            <span className="text-sm font-semibold font-sans-ui">{nearby.label}</span>
            {nearby.sublabel && (
              <span className="text-xs text-[#d1be9a] font-sans-ui">· {nearby.sublabel}</span>
            )}
          </button>
        </div>
      )}

      {/* Bottom-Left Cluster: Character Identity & Chapter Progress */}
      <div className="absolute bottom-4 left-4 bg-[#171411]/88 border border-[#d4ae62]/35 rounded-md px-3.5 py-2 shadow-lg flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#9e2a22] border border-[#e2b45a]/60 flex items-center justify-center text-[#fbf3e4] text-sm font-bold shrink-0">
          {identity === 'luzhishen' ? '禅' : '鲁'}
        </div>
        <div>
          <div className="text-sm font-bold text-[#f7f0e0] leading-tight">
            {identity === 'luzhishen' ? '花和尚 · 鲁智深' : '渭州提辖 · 鲁达'}
          </div>
          <div className="text-xs text-[#cbbba0] font-sans-ui flex items-center gap-2 mt-0.5">
            <span>主线进度</span>
            <span className="font-mono-num text-[#f0c766] font-semibold">
              {objective.completedCount}/{objective.totalSteps}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom-Right Subtle Action Shortcut */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onStrike();
          }}
          aria-label="施展武艺 (J)"
          className="h-9 px-3 rounded-md bg-[#171411]/88 hover:bg-[#2a221b] border border-[#d4ae62]/35 text-[#efe4ce] text-xs inline-flex items-center gap-1.5 shadow-md transition-colors cursor-pointer whitespace-nowrap font-sans-ui"
        >
          <Swords className="w-3.5 h-3.5 text-[#e5ba60]" aria-hidden="true" />
          <span>{identity === 'luzhishen' ? '挥禅杖' : '出重拳'}</span>
          <span className="font-mono-num text-[11px] text-[#cbb996]">[J]</span>
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenAtlas();
          }}
          aria-label="快速前往目标地点"
          className="hidden md:inline-flex h-9 px-3 rounded-md bg-[#171411]/88 hover:bg-[#2a221b] border border-[#d4ae62]/35 text-[#efe4ce] text-xs items-center gap-1.5 shadow-md transition-colors cursor-pointer whitespace-nowrap font-sans-ui"
        >
          <Compass className="w-3.5 h-3.5 text-[#7be092]" aria-hidden="true" />
          <span>目标：{objective.targetLabel}</span>
        </button>
      </div>
    </div>
  );
};
