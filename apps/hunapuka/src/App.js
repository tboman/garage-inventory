import React, { useState, useEffect, useCallback, useMemo } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { fetchItems, createItem, updateItem as apiUpdateItem, moveItem as apiMoveItem, deleteItem as apiDeleteItem } from './api';
import TreeItem from './components/TreeItem';
import RootDropZone from './components/RootDropZone';
import AddItemForm from './components/AddItemForm';
import ErrorAlert from './components/ErrorAlert';
import SearchBar from './components/SearchBar';
import SearchResults from './components/SearchResults';
import LoginScreen from './components/LoginScreen';
import { useAuth } from './contexts/AuthContext';

function App() {
  const { user, authLoading, logOut } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusItemId, setFocusItemId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    return id || null;
  });

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchItems()
      .then(data => setItems(data))
      .catch(err => setError(`Failed to load items: ${err.message}`))
      .finally(() => setLoading(false));
  }, [user]);

  const handleError = useCallback((message) => {
    setError(message);
  }, []);

  const getDescendantIds = useCallback((id, itemsList) => {
    const children = itemsList.filter(item => item.locationId === id);
    return children.reduce((acc, child) => [...acc, child.id, ...getDescendantIds(child.id, itemsList)], []);
  }, []);

  const addItem = async ({ name, locationId, description }) => {
    try {
      let newOrder = 0;
      setItems(prev => {
        const siblings = prev.filter(item => item.locationId === locationId);
        newOrder = siblings.length > 0
          ? Math.max(...siblings.map(s => s.order)) + 1
          : 0;
        return prev;
      });

      const newItem = {
        name,
        locationId,
        description,
        order: newOrder,
        photos: [],
      };

      const created = await createItem(newItem);
      setItems(prev => [...prev, created]);
    } catch (err) {
      setError(`Failed to add item: ${err.message}`);
    }
  };

  const updateItem = async (id, newName, newDescription) => {
    const snapshot = items;
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, name: newName, description: newDescription } : item
    ));
    try {
      await apiUpdateItem(id, { name: newName, description: newDescription });
    } catch (err) {
      setItems(snapshot);
      setError(`Failed to update item: ${err.message}`);
    }
  };

  const moveItem = async (draggedItemId, targetLocationId) => {
    const descendantIds = getDescendantIds(draggedItemId, items);
    if (descendantIds.includes(targetLocationId)) {
      setError('Cannot move an item into its own descendant');
      return;
    }

    const snapshot = items;

    let newOrder = 0;
    setItems(prev => {
      const siblings = prev.filter(item => item.locationId === targetLocationId && item.id !== draggedItemId);
      newOrder = siblings.length > 0
        ? Math.max(...siblings.map(s => s.order)) + 1
        : 0;
      return prev.map(item =>
        item.id === draggedItemId ? { ...item, locationId: targetLocationId, order: newOrder } : item
      );
    });

    try {
      await apiMoveItem(draggedItemId, targetLocationId, newOrder);
    } catch (err) {
      setItems(snapshot);
      setError(`Failed to move item: ${err.message}`);
    }
  };

  const deleteItem = async (id, childCount) => {
    const allDescendantIds = getDescendantIds(id, items);
    const totalDescendants = allDescendantIds.length;

    if (totalDescendants > 0) {
      const ok = window.confirm(`This has ${totalDescendants} item${totalDescendants > 1 ? 's' : ''} inside. Delete all?`);
      if (!ok) return;
    }

    const idsToDelete = [id, ...allDescendantIds];
    const snapshot = items;
    setItems(prev => prev.filter(item => !idsToDelete.includes(item.id)));

    try {
      for (const deleteId of idsToDelete) {
        await apiDeleteItem(deleteId);
      }
    } catch (err) {
      setItems(snapshot);
      setError(`Failed to delete item: ${err.message}`);
    }
  };

  const handlePhotoAdded = (itemId, photoPath) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, photos: [...(item.photos || []), photoPath] } : item
    ));
  };

  const handlePhotoRemoved = (itemId, photoPath) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, photos: (item.photos || []).filter(p => p !== photoPath) } : item
    ));
  };

  const rootItems = items
    .filter(item => item.locationId === null)
    .sort((a, b) => a.order - b.order);

  const searchResults = searchQuery.trim()
    ? items.filter(item => {
        const q = searchQuery.toLowerCase();
        return item.name.toLowerCase().includes(q) ||
               (item.description && item.description.toLowerCase().includes(q)) ||
               String(item.id).includes(q);
      })
    : [];

  const isSearching = searchQuery.trim().length > 0;

  const focusAncestorIds = useMemo(() => {
    if (!focusItemId) return new Set();
    const ids = new Set();
    let id = focusItemId;
    while (id !== null) {
      const item = items.find(i => i.id === id);
      if (!item) break;
      ids.add(item.id);
      id = item.locationId;
    }
    return ids;
  }, [focusItemId, items]);

  if (authLoading) {
    return (
      <div className="loading-container">
        <div className="spinner-border text-secondary mb-3" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="app-container">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="app-header mb-0">HunaPuka</h1>
          <div className="d-flex align-items-center gap-2">
            <span className="text-muted small">{user.displayName}</span>
            <button className="btn btn-outline-secondary btn-sm" onClick={logOut}>
              Sign out
            </button>
          </div>
        </div>

        <ErrorAlert message={error} onDismiss={() => setError(null)} />

        <AddItemForm items={items} onAddItem={addItem} />

        <SearchBar query={searchQuery} onChange={setSearchQuery} />

        {loading ? (
          <div className="loading-container">
            <div className="spinner-border text-secondary mb-3" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p>Loading inventory...</p>
          </div>
        ) : isSearching ? (
          <SearchResults results={searchResults} allItems={items} />
        ) : rootItems.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-box-open fa-2x mb-3 d-block"></i>
            <p>No items yet. Add your first item above!</p>
          </div>
        ) : (
          <RootDropZone moveItem={moveItem}>
            {rootItems.map(item => (
              <TreeItem
                key={item.id}
                item={item}
                allItems={items}
                depth={0}
                moveItem={moveItem}
                updateItem={updateItem}
                deleteItem={deleteItem}
                addItem={addItem}
                onPhotoAdded={handlePhotoAdded}
                onPhotoRemoved={handlePhotoRemoved}
                onError={handleError}
                focusItemId={focusItemId}
                focusAncestorIds={focusAncestorIds}
                onClearFocus={() => {
                  setFocusItemId(null);
                  window.history.replaceState({}, '', window.location.pathname);
                }}
              />
            ))}
          </RootDropZone>
        )}
      </div>
    </DndProvider>
  );
}

export default App;
