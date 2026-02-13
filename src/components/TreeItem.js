import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import PhotoUpload from './PhotoUpload';
import PhotoGallery from './PhotoGallery';

const ItemTypes = { ITEM: 'item' };

const TreeItem = ({ item, allItems, depth = 0, moveItem, updateItem, deleteItem, addItem, onPhotoAdded, onPhotoRemoved, onError, focusItemId, focusAncestorIds, onClearFocus }) => {
  const isFocused = focusItemId === item.id;
  const isOnFocusPath = focusAncestorIds && focusAncestorIds.has(item.id);

  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editedName, setEditedName] = useState(item.name);
  const [editedDescription, setEditedDescription] = useState(item.description);
  const [newChildName, setNewChildName] = useState('');
  const addInputRef = useRef(null);
  const itemRef = useRef(null);

  // Ensure ancestors of the focused item are expanded
  useEffect(() => {
    if (isOnFocusPath) {
      setIsOpen(true);
    }
  }, [isOnFocusPath]);

  // Scroll focused item into view and flash highlight
  useEffect(() => {
    if (isFocused && itemRef.current) {
      // Small delay to let the tree expand first
      const timer = setTimeout(() => {
        itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isFocused]);

  // Sync edit fields when item changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditedName(item.name);
      setEditedDescription(item.description);
    }
  }, [item.name, item.description, isEditing]);

  useEffect(() => {
    if (isAdding && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [isAdding]);

  const children = allItems
    .filter(child => child.locationId === item.id)
    .sort((a, b) => a.order - b.order);

  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.ITEM,
    item: { id: item.id },
    end: (draggedItem, monitor) => {
      const dropResult = monitor.getDropResult();
      if (draggedItem && dropResult) {
        moveItem(draggedItem.id, dropResult.targetId);
      }
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  const [{ isOver }, drop] = useDrop(() => ({
    accept: ItemTypes.ITEM,
    drop: (draggedItem, monitor) => {
      if (draggedItem.id === item.id) return;
      if (monitor.isOver({ shallow: true })) {
        return { targetId: item.id };
      }
      return undefined;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
    }),
  }));

  const combinedRef = useCallback((node) => {
    drag(drop(node));
    itemRef.current = node;
  }, [drag, drop]);

  const handleSave = () => {
    updateItem(item.id, editedName, editedDescription);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedName(item.name);
    setEditedDescription(item.description);
    setIsEditing(false);
  };

  const handleAddChild = (e) => {
    e.preventDefault();
    if (!newChildName.trim()) return;
    addItem({ name: newChildName.trim(), locationId: item.id, description: '' });
    setNewChildName('');
    setIsAdding(false);
    setIsOpen(true);
  };

  const depthColors = ['#6c757d', '#0d6efd', '#198754', '#dc3545', '#fd7e14', '#6f42c1'];
  const borderColor = depthColors[depth % depthColors.length];

  return (
    <li
      ref={combinedRef}
      className={`tree-item ${isOver ? 'tree-item-over' : ''} ${isFocused ? 'tree-item-focused' : ''}`}
      style={{
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: borderColor,
      }}
    >
      <div className="tree-item-content">
        {isEditing ? (
          <div className="d-flex flex-column w-100">
            <input
              type="text"
              className="form-control form-control-sm mb-2"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
            />
            <textarea
              className="form-control form-control-sm mb-2"
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              rows="2"
            />
            <div>
              <button className="btn btn-primary btn-sm me-2" onClick={handleSave}>Save</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={handleCancel}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="tree-item-info" onClick={() => setIsOpen(!isOpen)} style={{ cursor: 'pointer' }}>
              <div className="d-flex align-items-center">
                <span className="tree-toggle me-1">
                  {children.length > 0 ? (isOpen ? '▼' : '▶') : <span style={{ width: '1em', display: 'inline-block' }}></span>}
                </span>
                <strong>{item.name}</strong>
                <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>#{item.id}</span>
                {children.length > 0 && (
                  <span className="badge bg-secondary rounded-pill ms-2">{children.length}</span>
                )}
              </div>
              {item.description && <p className="tree-item-desc mb-0">{item.description}</p>}
            </div>
            <div className="tree-item-actions">
              {isFocused && (
                <button className="btn btn-outline-warning btn-sm" onClick={onClearFocus} title="Clear highlight">
                  <i className="fas fa-times"></i>
                </button>
              )}
              <button className="btn btn-outline-success btn-sm" onClick={() => setIsAdding(!isAdding)} title="Add item here">
                <i className="fas fa-plus"></i>
              </button>
              <PhotoUpload item={item} onPhotoAdded={onPhotoAdded} onError={onError} />
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setIsEditing(true)} title="Edit">
                <i className="fas fa-edit"></i>
              </button>
              <button className="btn btn-outline-danger btn-sm" onClick={() => deleteItem(item.id)} title="Delete">
                <i className="fas fa-trash"></i>
              </button>
            </div>
          </>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleAddChild} className="d-flex gap-2 mt-2">
          <input
            ref={addInputRef}
            type="text"
            className="form-control form-control-sm"
            placeholder={`Add item inside ${item.name}...`}
            value={newChildName}
            onChange={(e) => setNewChildName(e.target.value)}
          />
          <button type="submit" className="btn btn-success btn-sm" disabled={!newChildName.trim()}>Add</button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setIsAdding(false); setNewChildName(''); }}>
            <i className="fas fa-times"></i>
          </button>
        </form>
      )}

      {isOpen && (
        <PhotoGallery item={item} onPhotoRemoved={onPhotoRemoved} onError={onError} />
      )}

      {isOpen && children.length > 0 && (
        <ul className="list-group tree-children">
          {children.map(child => (
            <TreeItem
              key={child.id}
              item={child}
              allItems={allItems}
              depth={depth + 1}
              moveItem={moveItem}
              updateItem={updateItem}
              deleteItem={deleteItem}
              addItem={addItem}
              onPhotoAdded={onPhotoAdded}
              onPhotoRemoved={onPhotoRemoved}
              onError={onError}
              focusItemId={focusItemId}
              focusAncestorIds={focusAncestorIds}
              onClearFocus={onClearFocus}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

export default TreeItem;
