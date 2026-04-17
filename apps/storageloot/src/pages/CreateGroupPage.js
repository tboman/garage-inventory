import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { createGroup } from '../api';

const types = [
  { value: 'container', label: 'Container' },
  { value: 'box', label: 'Box' },
  { value: 'storage', label: 'Storage Unit' },
  { value: 'garage', label: 'Garage' },
  { value: 'custom', label: 'Custom' },
];

export default function CreateGroupPage() {
  const { user, login, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState('box');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (authLoading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to create a group</h2>
        <p className="text-muted">You need a Google account to create groups on StorageLoot.</p>
        <button className="btn btn-sl btn-lg" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const id = await createGroup({ name: name.trim(), type }, user);
      navigate(`/group/${id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const isValid = name.trim().length > 0 && name.trim().length <= 80;

  return (
    <div className="container py-4" style={{ maxWidth: 600 }}>
      <h2 className="fw-bold mb-4">Create Group</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="form-label fw-semibold">Group Name</label>
          <input
            type="text"
            className="form-control"
            maxLength={80}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Garage cleanout, Estate sale box #3"
            required
          />
          <div className="form-text">{name.length}/80</div>
        </div>

        <div className="mb-4">
          <label className="form-label fw-semibold">Type</label>
          <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
            {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <button type="submit" className="btn btn-sl btn-lg w-100" disabled={!isValid || saving}>
          {saving ? (
            <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</>
          ) : 'Create Group'}
        </button>
      </form>
    </div>
  );
}
