import React from 'react';
import { useDrop } from 'react-dnd';

const ItemTypes = { ITEM: 'item' };

const RootDropZone = ({ children, moveItem }) => {
  const [{ isOverRoot }, dropRoot] = useDrop(() => ({
    accept: ItemTypes.ITEM,
    drop: (draggedItem, monitor) => {
      if (monitor.didDrop()) return;
      return { targetId: null };
    },
    collect: (monitor) => ({
      isOverRoot: monitor.isOver(),
    }),
  }));

  return (
    <ul
      ref={dropRoot}
      className="list-group tree-root"
      style={{ backgroundColor: isOverRoot ? '#e9ecef' : 'transparent' }}
    >
      {children}
    </ul>
  );
};

export default RootDropZone;
