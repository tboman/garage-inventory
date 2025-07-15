import React, { useState, useEffect } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

const ItemTypes = {
  ITEM: 'item',
};

const TreeItem = ({ item, allItems, moveItem, updateItem, deleteItem }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(item.name);
  const [editedDescription, setEditedDescription] = useState(item.description);

  const children = allItems.filter(child => child.locationId === item.id).sort((a, b) => a.order - b.order);

  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.ITEM,
    item: { id: item.id },
    end: (draggedItem, monitor) => {
      const dropResult = monitor.getDropResult();
      if (draggedItem && dropResult) {
        console.log('useDrag end: draggedItem.id =', draggedItem.id, ', dropResult =', dropResult);
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
      if (draggedItem.id === item.id) { // Prevent dropping onto itself
        return;
      }
      if (monitor.isOver({ shallow: true })) { // Only process if it's the innermost droppable
        console.log('TreeItem drop (shallow): draggedItem.id =', draggedItem.id, ', target item.id =', item.id);
        return { targetId: item.id }; // Return the target item's ID as the drop result
      }
      return undefined; // Don't return a result if not the shallowest
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }));

  const handleSave = () => {
    updateItem(item.id, editedName, editedDescription);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedName(item.name);
    setEditedDescription(item.description);
    setIsEditing(false);
  };

  return (
    <li
      ref={(node) => drag(drop(node))}
      className="list-group-item d-flex justify-content-between align-items-start"
      style={{ opacity: isDragging ? 0.5 : 1, backgroundColor: isOver ? '#e9ecef' : '#f8f9fa', borderLeft: '5px solid #6c757d' }}
    >
      <div style={{ flexGrow: 1 }}>
        {isEditing ? (
          <div className="d-flex flex-column">
            <input
              type="text"
              className="form-control mb-2"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
            />
            <textarea
              className="form-control mb-2"
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
            />
            <div>
              <button className="btn btn-primary btn-sm me-2" onClick={handleSave} style={{ backgroundColor: '#007bff', borderColor: '#007bff' }}>Save</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={handleCancel}>Cancel</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setIsOpen(!isOpen)} style={{ cursor: 'pointer'}}>
            <h5>
              <span style={{ marginRight: '5px' }}>{children.length > 0 ? (isOpen ? '▼' : '▶') : ''}</span>
              {item.name}
              {children.length > 0 && (
                <span className="badge bg-secondary rounded-pill ms-2">
                  {children.length}
                </span>
              )}
            </h5>
            {item.description && <p className="mb-0" style={{ color: '#495057' }}>{item.description}</p>}
          </div>
        )}
      </div>
      {!isEditing && (
        <div className="d-flex flex-column">
          <button className="btn btn-outline-secondary btn-sm mb-1" onClick={() => setIsEditing(true)}>
            <i className="fas fa-edit"></i>
          </button>
          <button className="btn btn-outline-danger btn-sm" onClick={() => deleteItem(item.id)}>
            <i className="fas fa-trash"></i>
          </button>
        </div>
      )}
      {isOpen && children.length > 0 && (
        <ul className="list-group list-group-flush w-100 mt-2">
          {children.map(child => (
            <TreeItem key={child.id} item={child} allItems={allItems} moveItem={moveItem} updateItem={updateItem} deleteItem={deleteItem} />
          ))}
        </ul>
      )}
    </li>
  );
};

const RootDropZone = ({ children, moveItem }) => {
  const [{ isOverRoot }, dropRoot] = useDrop(() => ({
    accept: ItemTypes.ITEM,
    drop: (draggedItem, monitor) => {
      if (monitor.didDrop()) {
        // If a child drop target already handled the drop, do nothing here
        return;
      }
      console.log('RootDropZone drop: draggedItem.id =', draggedItem.id);
      return { targetId: null }; // Return null as the drop result for root
    },
    collect: (monitor) => ({
      isOverRoot: monitor.isOver(),
    }),
  }));

  return (
    <ul
      ref={dropRoot}
      className="list-group"
      style={{ backgroundColor: isOverRoot ? '#e9ecef' : '#e2e6ea' }}
    >
      {children}
    </ul>
  );
};

function App() {
  const [items, setItems] = useState([]);
  const [itemName, setItemName] = useState('');
  const [itemLocation, setItemLocation] = useState('');
  const [itemDescription, setItemDescription] = useState('');

  useEffect(() => {
    fetch('/items')
      .then(res => {
        if (!res.ok) {
          if (res.status === 404) {
            return []; // Return empty array for 404
          } else {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
        }
        return res.json();
      })
      .then(data => {
        const processedData = data.map(item => ({
          ...item,
          id: parseInt(item.id),
          locationId: item.locationId !== null ? parseInt(item.locationId) : null,
          order: item.order !== undefined ? parseInt(item.order) : 0
        }));
        setItems(processedData);
      })
      .catch(error => {
        console.error("Error fetching items:", error);
        setItems([]); // Initialize with empty array on error
      });
  }, []);

  const addItem = (e) => {
    e.preventDefault();
    const locationId = itemLocation ? parseInt(itemLocation) : null;

    const siblingsInLocation = items.filter(item => item.locationId === locationId);
    const newOrder = siblingsInLocation.length > 0
      ? Math.max(...siblingsInLocation.map(s => s.order)) + 1
      : 0;

    const newItem = {
      id: Math.floor(Math.random() * 1000000),
      name: itemName,
      locationId,
      description: itemDescription,
      order: newOrder
    };

    console.log("Sending new item to server:", newItem);

    fetch('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newItem)
    })
      .then(res => res.json())
      .then(newItemFromServer => {
        console.log("Received new item from server:", newItemFromServer);
        const processedItem = {
          ...newItemFromServer,
          id: parseInt(newItemFromServer.id),
          locationId: newItemFromServer.locationId !== null ? parseInt(newItemFromServer.locationId) : null,
          order: parseInt(newItemFromServer.order)
        };
        setItems(prevItems => [...prevItems, processedItem]);
        setItemName('');
        setItemDescription('');
      });
  };

  const updateItem = (id, newName, newDescription) => {
    setItems(prevItems => {
      const updatedItems = prevItems.map(item => {
        if (item.id === id) {
          return { ...item, name: newName, description: newDescription };
        }
        return item;
      });

      // Update backend
      fetch(`/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: newDescription }),
      })
        .then(res => res.json())
        .then(data => console.log('Item updated successfully:', data))
        .catch(error => console.error('Error updating item:', error));

      return updatedItems;
    });
  };

  const moveItem = (draggedItemId, targetLocationId) => {
    console.log('moveItem called: draggedItemId =', draggedItemId, ', targetLocationId =', targetLocationId);
    setItems(prevItems => {
      const draggedItem = prevItems.find(item => item.id === draggedItemId);
      if (!draggedItem) {
        console.log('draggedItem not found');
        return prevItems;
      }

      // Calculate new order for the dragged item in its new location
      const siblingsInNewLocation = prevItems.filter(item => item.locationId === targetLocationId && item.id !== draggedItemId);
      const newOrder = siblingsInNewLocation.length > 0
        ? Math.max(...siblingsInNewLocation.map(s => s.order)) + 1
        : 0;

      const updatedItems = prevItems.map(item => {
        if (item.id === draggedItemId) {
          return { ...item, locationId: targetLocationId, order: newOrder };
        }
        return item;
      });

      // Update backend
      fetch(`/items/${draggedItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: targetLocationId, order: newOrder }),
      })
        .then(res => res.json())
        .then(data => console.log('Item moved successfully:', data))
        .catch(error => console.error('Error moving item:', error));

      return updatedItems;
    });
  };

  const deleteItem = (id) => {
    fetch(`/items/${id}`, {
      method: 'DELETE',
    })
      .then(res => {
        if (res.ok) {
          setItems(prevItems => prevItems.filter(item => item.id !== id));
          console.log('Item deleted successfully');
        } else {
          console.error('Failed to delete item');
        }
      })
      .catch(error => console.error('Error deleting item:', error));
  };

  const getIndentedOptions = (items, parentId = null, indent = 0) => {
    const options = [];
    const directChildren = items.filter(item => item.locationId === parentId).sort((a, b) => b.order - a.order);

    directChildren.forEach(item => {
      options.push({
        id: item.id,
        name: '---'.repeat(indent) + item.name,
      });
      options.push(...getIndentedOptions(items, item.id, indent + 1));
    });
    return options;
  };

  const indentedOptions = getIndentedOptions(items);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="container mt-5" style={{ backgroundColor: '#e9ecef', padding: '20px', borderRadius: '8px' }}>
        <h1 className="text-center mb-4" style={{ color: '#343a40' }}>HunaPuka</h1>
        <form onSubmit={addItem} className="mb-5 p-3" style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #dee2e6' }}>
          <div className="row">
            <div className="col-12 col-md-6 mb-3">
              <select className="form-control" value={itemLocation} onChange={e => setItemLocation(e.target.value)} style={{ borderColor: '#adb5bd' }}>
                <option value="">-- Select Location (or leave blank for root) --</option>
                {indentedOptions.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-6 mb-3">
              <input type="text" className="form-control" placeholder="Item Name" value={itemName} onChange={e => setItemName(e.target.value)} required style={{ borderColor: '#adb5bd' }}/>
            </div>
            <div className="col-12 mb-3">
              <textarea className="form-control" placeholder="Description" value={itemDescription} onChange={e => setItemDescription(e.target.value)} style={{ borderColor: '#adb5bd' }}/>
            </div>
            <div className="col-12">
              <button type="submit" className="btn btn-primary w-100" style={{ backgroundColor: '#007bff', borderColor: '#007bff' }}>Add Item</button>
            </div>
          </div>
        </form>
        <RootDropZone moveItem={moveItem}>
          {items.filter(item => item.locationId === null).sort((a, b) => a.order - b.order).map(item => (
            <TreeItem key={item.id} item={item} allItems={items} moveItem={moveItem} updateItem={updateItem} deleteItem={deleteItem} />
          ))}
        </RootDropZone>
      </div>
    </DndProvider>
  );
}

export default App;