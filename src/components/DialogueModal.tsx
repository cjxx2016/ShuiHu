import React from 'react';
import type { DialogueChoice, DialogueNode } from '../types/world';

interface DialogueModalProps {
  node: DialogueNode;
  onSelectChoice: (choice: DialogueChoice) => void;
  onClose: () => void;
}

export const DialogueModal: React.FC<DialogueModalProps> = ({
  node,
  onSelectChoice,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-auto"
      role="dialog"
      aria-label={`${node.speaker} 对话`}
    >
      <div className="w-full max-w-2xl rounded-md bg-[#1a1612]/96 border border-[#d8b062]/55 shadow-2xl p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-4 border-b border-[#d8b062]/25 pb-2.5 mb-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-lg font-bold text-[#f7d276] tracking-wide">{node.speaker}</h2>
            <span className="text-xs text-[#cbbca0] font-sans-ui">{node.speakerTitle}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[#c7b89c] hover:text-[#ffffff] cursor-pointer font-sans-ui"
          >
            关闭 [Esc]
          </button>
        </div>

        <p className="text-sm sm:text-base leading-relaxed text-[#f2eadc] mb-4 font-sans-ui">
          {node.text}
        </p>

        <div className="flex flex-col gap-2">
          {node.choices.map((choice, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectChoice(choice)}
              className="w-full text-left px-4 py-2.5 rounded bg-[#29221b] hover:bg-[#9c2e24] border border-[#d8b062]/30 hover:border-[#f0c76d]/70 text-sm text-[#faf2e3] transition-colors cursor-pointer font-sans-ui"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
