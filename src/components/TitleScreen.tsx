import React from 'react';
import { Compass, Map as MapIcon } from 'lucide-react';

interface TitleScreenProps {
  onStart: () => void;
  onOpenAtlas: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({ onStart, onOpenAtlas }) => {
  return (
    <div
      className="fixed inset-0 z-30 flex flex-col justify-between pointer-events-none"
      style={{
        background:
          'linear-gradient(90deg, rgba(19, 16, 13, 0.84) 0%, rgba(19, 16, 13, 0.45) 38%, rgba(19, 16, 13, 0.0) 68%)',
      }}
    >
      <div className="flex-1 flex items-center px-8 md:px-16 lg:px-20">
        <div className="max-w-lg pointer-events-auto">
          {/* Custom inline SVG Song-dynasty cinnabar seal + calligraphed title lockup */}
          <div className="mb-6">
            <svg
              viewBox="0 0 430 112"
              className="w-full max-w-[400px] h-auto"
              role="img"
              aria-label="水浒 · 智深行记"
            >
              {/* Vermilion Song Dynasty Square Seal */}
              <rect
                x="4"
                y="14"
                width="68"
                height="68"
                rx="6"
                fill="#9e2a22"
                stroke="#e2b45a"
                strokeWidth="2.5"
              />
              <rect
                x="10"
                y="20"
                width="56"
                height="56"
                rx="3"
                fill="none"
                stroke="#f5e6c8"
                strokeWidth="1.2"
                strokeOpacity="0.65"
              />
              <text
                x="38"
                y="45"
                textAnchor="middle"
                fill="#f8efe0"
                fontSize="20"
                fontWeight="700"
                fontFamily="Noto Serif SC, Songti SC, serif"
              >
                水浒
              </text>
              <text
                x="38"
                y="68"
                textAnchor="middle"
                fill="#f2c96d"
                fontSize="16"
                fontWeight="700"
                fontFamily="Noto Serif SC, Songti SC, serif"
              >
                行记
              </text>

              {/* Main Display Title */}
              <text
                x="88"
                y="54"
                fill="#f7f0e2"
                fontSize="40"
                fontWeight="700"
                letterSpacing="4"
                fontFamily="Noto Serif SC, Songti SC, serif"
              >
                智深行记
              </text>
              {/* Subtle horizontal gold brush rule */}
              <line x1="88" y1="68" x2="412" y2="68" stroke="#d8ad56" strokeWidth="1.5" strokeOpacity="0.7" />
              <text
                x="88"
                y="90"
                fill="#e2d5bc"
                fontSize="14.5"
                letterSpacing="2"
                fontFamily="Noto Serif SC, Songti SC, serif"
              >
                渭州 · 五台山 · 东京汴梁半开放体素世界
              </text>
            </svg>
          </div>

          <p className="text-sm md:text-base leading-relaxed text-[#e2d8c5] mb-8 max-w-md font-sans-ui">
            循鲁提辖前期江湖动线，游历渭州郊野与状元桥坊、登临巍峨五台山文殊院剃度受戒，终赴大宋东京汴梁城御街烟火与大相国寺菜园。
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              data-start="true"
              onClick={onStart}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-md bg-[#a63026] hover:bg-[#be382c] text-[#fbf5e8] font-semibold text-base tracking-wide border border-[#e3b962]/60 shadow-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e3b962]"
            >
              <Compass className="w-5 h-5" aria-hidden="true" />
              <span>开始游历</span>
            </button>

            <button
              type="button"
              onClick={onOpenAtlas}
              className="inline-flex items-center gap-2 px-5 py-3.5 rounded-md bg-[#1f1b17]/90 hover:bg-[#2c2620] text-[#eadfc9] font-medium text-sm tracking-wide border border-[#d6b26a]/35 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e3b962]"
            >
              <MapIcon className="w-4 h-4" aria-hidden="true" />
              <span>浏览七大场景舆图</span>
            </button>
          </div>
        </div>
      </div>

      {/* Single flat borderless inline control hint */}
      <div className="px-8 md:px-16 pb-6 text-xs text-[#cfc4ae] tracking-wide font-sans-ui">
        WASD 移动 · 鼠标拖拽转视角 · Space 跳跃 · E 对话/进出场景 · J 施展武艺 · M 舆图 · Esc 暂停
      </div>
    </div>
  );
};
