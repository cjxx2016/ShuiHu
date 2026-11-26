import React from 'react';
import { X, Compass, Landmark, DoorOpen, MapPin } from 'lucide-react';
import { AREA_ORDER, AREAS } from '../game/worldData';
import type { AreaId, AreaTier, QuestObjective } from '../types/world';

interface WorldAtlasModalProps {
  currentArea: AreaId;
  objective: QuestObjective;
  onTravel: (areaId: AreaId) => void;
  onClose: () => void;
}

const TIER_SECTIONS: Array<{
  tier: AreaTier;
  heading: string;
  desc: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  {
    tier: 'region',
    heading: '开放地理区域（2 处）',
    desc: '巍峨山川、河流官道与野外植被，供自由漫游与路径探索',
    Icon: Compass,
  },
  {
    tier: 'scene',
    heading: '城镇与寺观场景（3 处）',
    desc: '建筑群落、市井烟火与主线任务事件核心区域',
    Icon: Landmark,
  },
  {
    tier: 'interior',
    heading: '建筑内部空间（2 处）',
    desc: '近景室内陈设、人物深层对话与剧情转折节点',
    Icon: DoorOpen,
  },
];

export const WorldAtlasModal: React.FC<WorldAtlasModalProps> = ({
  currentArea,
  objective,
  onTravel,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 bg-[#0f0d0a]/82 flex items-center justify-center p-4 sm:p-6 pointer-events-auto"
      role="dialog"
      aria-label="水浒舆图 · 七大场景切换"
    >
      <div className="w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-md bg-[#191511] border border-[#d6ae60]/50 shadow-2xl p-6">
        <div className="flex items-start justify-between gap-4 border-b border-[#d6ae60]/25 pb-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-[#f8f0df] tracking-wide">
              水浒舆图 · 鲁智深行纪全览
            </h2>
            <p className="text-xs sm:text-sm text-[#c7b99f] mt-1 font-sans-ui">
              可沿道路、城门与殿门步行无缝切换，亦可通过舆图直抵各区域、场景与建筑内部。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭舆图"
            className="w-9 h-9 rounded bg-[#27211b] hover:bg-[#382f26] border border-[#d6ae60]/30 text-[#efe3cc] inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-6">
          {TIER_SECTIONS.map(({ tier, heading, desc, Icon }) => {
            const areas = AREA_ORDER.map((id) => AREAS[id]).filter((a) => a.tier === tier);
            return (
              <section key={tier}>
                <div className="flex flex-wrap items-baseline gap-2.5 mb-3">
                  <Icon className="w-4 h-4 text-[#e3b960] self-center" />
                  <h3 className="text-base font-bold text-[#f3e6cb]">{heading}</h3>
                  <span className="text-xs text-[#b5a78f] font-sans-ui">{desc}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {areas.map((area) => {
                    const isHere = area.id === currentArea;
                    const isTarget = !objective.allCompleted && objective.targetArea === area.id;
                    return (
                      <button
                        key={area.id}
                        type="button"
                        onClick={() => onTravel(area.id)}
                        className={`text-left p-4 rounded-md border transition-colors cursor-pointer flex flex-col justify-between gap-2 ${
                          isHere
                            ? 'bg-[#2e2319] border-[#e5ba5f]'
                            : 'bg-[#211c17] hover:bg-[#2c251e] border-[#d6ae60]/25 hover:border-[#d6ae60]/60'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-[#faf2e2]">{area.name}</span>
                            {isHere && (
                              <span className="text-[11px] font-medium text-[#7be092] font-sans-ui whitespace-nowrap">
                                当前所在
                              </span>
                            )}
                            {!isHere && isTarget && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#f2c65e] font-sans-ui whitespace-nowrap">
                                <MapPin className="w-3 h-3" aria-hidden="true" />
                                主线目标
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#c7baa2] mt-1 leading-relaxed font-sans-ui">
                            {area.subtitle}
                          </p>
                        </div>
                        <div className="text-[11px] text-[#9f917a] italic pt-2 border-t border-[#d6ae60]/15">
                          「{area.poem}」
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
