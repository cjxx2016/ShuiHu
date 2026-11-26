import React from 'react';
import type { GameMode, QuestObjective } from '../types/world';

interface PauseVictoryModalProps {
  mode: Extract<GameMode, 'paused' | 'gameover'>;
  objective: QuestObjective;
  visitedCount: number;
  onResume: () => void;
  onOpenAtlas: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export const PauseVictoryModal: React.FC<PauseVictoryModalProps> = ({
  mode,
  objective,
  visitedCount,
  onResume,
  onOpenAtlas,
  onRestart,
  onReturnTitle,
}) => {
  const isVictory = mode === 'gameover';

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0e0c09]/80 flex items-center justify-center p-4 pointer-events-auto"
      role="dialog"
      aria-label={isVictory ? '主线游历圆满' : '游戏已暂停'}
    >
      <div className="w-full max-w-md rounded-md bg-[#191511] border border-[#d8b062]/55 shadow-2xl p-6 text-center">
        <h2 className="text-2xl font-bold text-[#f9f1e1] tracking-wide">
          {isVictory ? '花和尚威震东京' : '暂歇江湖'}
        </h2>
        <p className="text-sm text-[#cfc2ab] mt-2 leading-relaxed font-sans-ui">
          {isVictory
            ? '从渭州拳打镇关西、五台山剃度闹山门，到东京汴梁倒拔垂杨柳，鲁智深前期主线已圆满完成。'
            : '可随时继续漫游大宋山河，或打开水浒舆图前往任意区域、场景与建筑内部。'}
        </p>

        <div className="grid grid-cols-2 gap-3 my-5">
          <div className="rounded bg-[#231d17] border border-[#d8b062]/25 p-3">
            <div className="text-xs text-[#b5a78f] font-sans-ui">主线章节</div>
            <div className="text-xl font-bold text-[#f2c966] font-mono-num mt-1">
              {objective.completedCount} / {objective.totalSteps}
            </div>
          </div>
          <div className="rounded bg-[#231d17] border border-[#d8b062]/25 p-3">
            <div className="text-xs text-[#b5a78f] font-sans-ui">已游历地点</div>
            <div className="text-xl font-bold text-[#7be092] font-mono-num mt-1">
              {visitedCount} / 7
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 font-sans-ui">
          <button
            type="button"
            data-start={isVictory ? 'true' : undefined}
            onClick={onResume}
            className="w-full py-2.5 rounded bg-[#a63026] hover:bg-[#bd382d] border border-[#e5ba60]/60 text-[#fdf6e8] font-semibold text-sm transition-colors cursor-pointer"
          >
            {isVictory ? '继续自由漫游' : '继续游历'}
          </button>
          <button
            type="button"
            onClick={onOpenAtlas}
            className="w-full py-2.5 rounded bg-[#26201a] hover:bg-[#342c24] border border-[#d8b062]/30 text-[#efe3cc] text-sm transition-colors cursor-pointer"
          >
            打开水浒舆图
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onRestart}
              className="py-2 rounded bg-[#211c17] hover:bg-[#302821] border border-[#d8b062]/25 text-[#d8cbb4] text-xs transition-colors cursor-pointer"
            >
              重置剧情进度
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="py-2 rounded bg-[#211c17] hover:bg-[#302821] border border-[#d8b062]/25 text-[#d8cbb4] text-xs transition-colors cursor-pointer"
            >
              返回标题画面
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
