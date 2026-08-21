import React, { useState, useEffect, useCallback, useMemo } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { fetchItems, fetchItemsFor, createItem, updateItem as apiUpdateItem, moveItem as apiMoveItem, deleteItem as apiDeleteItem, placeItem as apiPlaceItem, unplaceItem as apiUnplaceItem } from './api';
import TreeItem from './components/TreeItem';
import RootDropZone from './components/RootDropZone';
import AddItemForm from './components/AddItemForm';
import ErrorAlert from './components/ErrorAlert';
import SearchBar from './components/SearchBar';
import SearchResults from './components/SearchResults';
import LoginScreen from './components/LoginScreen';
import BrowseMode from './components/BrowseMode';
import PlacementEditor from './components/PlacementEditor';
import AccountSection from './components/AccountSection';
import { hasValidGoogleToken, subscribeGoogleToken, getGoogleAccessToken } from './googleToken';
import { useAuth } from './contexts/AuthContext';

// The two modes live in the URL so a browse position survives a refresh and the
// browser back button walks back up the containers you drilled into.
function readView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return {
    view: view === 'browse' || view === 'account' ? view : 'manage',
    at: params.get('at') || null,
  };
}

function writeView(view, at, { replace = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  params.delete('id');
  if (view === 'browse') {
    params.set('view', 'browse');
    if (at) params.set('at', at);
    else params.delete('at');
  } else if (view === 'account') {
    params.set('view', 'account');
    params.delete('at');
  } else {
    params.delete('view');
    params.delete('at');
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

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
  const [viewMode, setViewMode] = useState(() => readView().view);
  const [browseAt, setBrowseAt] = useState(() => readView().at);
  // null when not arranging; { id } where id is a container id or null for root.
  const [arranging, setArranging] = useState(null);
  // null while looking at your own inventory; otherwise the owner whose
  // inventory is on screen, which is always read only.
  const [activeOwner, setActiveOwner] = useState(null);
  const [driveConnected, setDriveConnected] = useState(() => hasValidGoogleToken());
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (activeOwner ? fetchItemsFor(activeOwner.uid) : fetchItems())
      .then(data => setItems(data))
      .catch(err => setError(`Failed to load items: ${err.message}`))
      .finally(() => setLoading(false));
  }, [user, activeOwner]);

  useEffect(() => {
    const onPop = () => {
      const next = readView();
      setViewMode(next.view);
      setBrowseAt(next.at);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The Drive token lapses on a timer rather than an event, so poll alongside
  // the subscription to catch the moment photos stop being loadable.
  useEffect(() => {
    const check = () => setDriveConnected(hasValidGoogleToken());
    check();
    const timer = setInterval(check, 30000);
    const unsubscribe = subscribeGoogleToken(check);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  const handleError = useCallback((message) => {
    setError(message);
  }, []);

  const getDescendantIds = useCallback((id, itemsList) => {
    const children = itemsList.filter(item => item.locationId === id);
    return children.reduce((acc, child) => [...acc, child.id, ...getDescendantIds(child.id, itemsList)], []);
  }, []);

  const addItem = async ({ name, locationId, description }) => {
    try {
      // New items go to the top of their location, so the thing you just added
      // is the thing you are looking at. order is only a sort key, so running
      // negative as items are added is fine.
      const siblings = items.filter(i => i.locationId === locationId);
      const newOrder = siblings.length > 0
        ? Math.min(...siblings.map(s => s.order)) - 1
        : 0;

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
        // x/y are relative to the old parent's canvas, so a reparent voids them.
        item.id === draggedItemId
          ? { ...item, locationId: targetLocationId, order: newOrder, x: null, y: null }
          : item
      );
    });

    try {
      await apiMoveItem(draggedItemId, targetLocationId, newOrder);
    } catch (err) {
      setItems(snapshot);
      setError(`Failed to move item: ${err.message}`);
    }
  };

  const placeItem = async (id, x, y) => {
    const snapshot = items;
    setItems(prev => prev.map(item => (item.id === id ? { ...item, x, y } : item)));
    try {
      await apiPlaceItem(id, x, y);
    } catch (err) {
      setItems(snapshot);
      setError(`Failed to place item: ${err.message}`);
    }
  };

  const unplaceItem = async (id) => {
    const snapshot = items;
    setItems(prev => prev.map(item => (item.id === id ? { ...item, x: null, y: null } : item)));
    try {
      await apiUnplaceItem(id);
    } catch (err) {
      setItems(snapshot);
      setError(`Failed to remove placement: ${err.message}`);
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

  const navigateBrowse = (id) => {
    setBrowseAt(id);
    writeView('browse', id);
  };

  const enterBrowse = () => {
    setViewMode('browse');
    setArranging(null);
    writeView('browse', browseAt);
  };

  // Interactive re-auth belongs on a real click, never on an image mount.
  const reconnectDrive = async () => {
    setReconnecting(true);
    try {
      await getGoogleAccessToken();
      setDriveConnected(hasValidGoogleToken());
    } catch (err) {
      setError(`Could not connect Google Drive: ${err.message}`);
    } finally {
      setReconnecting(false);
    }
  };

  const enterAccount = () => {
    setViewMode('account');
    setArranging(null);
    writeView('account', null);
  };

  // A shared inventory is someone else's data, so it opens in Browse and every
  // editing surface stays out of reach until you come back to your own.
  const viewSharedInventory = (owner) => {
    setActiveOwner(owner);
    setBrowseAt(null);
    setArranging(null);
    setViewMode('browse');
    writeView('browse', null);
  };

  const returnToMyInventory = () => {
    setActiveOwner(null);
    setBrowseAt(null);
    setArranging(null);
    setViewMode('manage');
    writeView('manage', null);
  };

  const enterManage = () => {
    // Reached from the header and from Browse's own exit button, so this is the
    // one place that has to refuse to open the editor on someone else's items.
    if (activeOwner) {
      returnToMyInventory();
      return;
    }
    setViewMode('manage');
    setArranging(null);
    writeView('manage', null);
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
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h1 className="app-header mb-0">HunaPuka</h1>
          <div className="d-flex align-items-center gap-2">
            <div className="btn-group btn-group-sm" role="group" aria-label="View mode">
              <button
                type="button"
                className={`btn ${viewMode === 'manage' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                onClick={enterManage}
              >
                <i className="fas fa-pen me-1"></i>Manage
              </button>
              <button
                type="button"
                className={`btn ${viewMode === 'browse' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                onClick={enterBrowse}
              >
                <i className="fas fa-images me-1"></i>Browse
              </button>
              <button
                type="button"
                className={`btn ${viewMode === 'account' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                onClick={enterAccount}
              >
                <i className="fas fa-user me-1"></i>Account
              </button>
            </div>
            <span className="text-muted small d-none d-sm-inline">{user.displayName}</span>
            <button className="btn btn-outline-secondary btn-sm" onClick={logOut}>
              Sign out
            </button>
          </div>
        </div>

        <ErrorAlert message={error} onDismiss={() => setError(null)} />

        {activeOwner && (
          <div className="alert alert-info d-flex align-items-center gap-2 py-2 px-3">
            <i className="fas fa-eye"></i>
            <span className="small flex-grow-1">
              Viewing <strong>{activeOwner.ownerName || activeOwner.ownerEmail}</strong>'s
              inventory. Read only.
            </span>
            <button
              className="btn btn-outline-secondary btn-sm flex-shrink-0"
              onClick={returnToMyInventory}
            >
              Back to mine
            </button>
          </div>
        )}

        {!driveConnected && (
          <div className="alert alert-warning d-flex align-items-center gap-2 py-2 px-3">
            <i className="fas fa-image"></i>
            <span className="small flex-grow-1">
              Photos need Google Drive access to load.
            </span>
            <button
              className="btn btn-warning btn-sm flex-shrink-0"
              onClick={reconnectDrive}
              disabled={reconnecting}
            >
              {reconnecting ? 'Connecting...' : 'Reconnect'}
            </button>
          </div>
        )}

        {viewMode === 'account' ? (
          <AccountSection
            user={user}
            onError={handleError}
            onViewShared={viewSharedInventory}
            activeOwnerUid={activeOwner ? activeOwner.uid : null}
          />
        ) : loading ? (
          <div className="loading-container">
            <div className="spinner-border text-secondary mb-3" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p>Loading inventory...</p>
          </div>
        ) : viewMode === 'browse' ? (
          <BrowseMode
            items={items}
            at={browseAt}
            onNavigate={navigateBrowse}
            onExit={enterManage}
            canShowPhotos={!activeOwner && driveConnected}
          />
        ) : arranging ? (
          <PlacementEditor
            container={arranging.id ? items.find(i => i.id === arranging.id) || null : null}
            allItems={items}
            onPlace={placeItem}
            onUnplace={unplaceItem}
            onNavigate={(id) => setArranging({ id })}
            onClose={() => setArranging(null)}
          />
        ) : (
          <>
            <AddItemForm items={items} onAddItem={addItem} />

            <div className="d-flex align-items-center gap-2 mb-2">
              <div className="flex-grow-1">
                <SearchBar query={searchQuery} onChange={setSearchQuery} />
              </div>
              <button
                className="btn btn-outline-secondary btn-sm flex-shrink-0"
                onClick={() => setArranging({ id: null })}
                title="Arrange the top level visually"
              >
                <i className="fas fa-table-cells-large me-1"></i>Arrange
              </button>
            </div>

            {isSearching ? (
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
                    onArrange={(id) => setArranging({ id })}
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
          </>
        )}
      </div>
    </DndProvider>
  );
}

export default App;
