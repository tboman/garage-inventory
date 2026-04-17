import { useState } from 'react';

const types = [
  { value: 'container', label: 'Container' },
  { value: 'box', label: 'Box' },
  { value: 'storage', label: 'Storage Unit' },
  { value: 'garage', label: 'Garage' },
  { value: 'custom', label: 'Custom' },
];

export default function GroupForm({ initial = {}, onSubmit, submitLabel = 'Save', loading = false }) {
  const [name, setName] = useState(initial.name || '');
  const [type, setType] = useState(initial.type || 'box');
  const [description, setDescription] = useState(initial.description || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      type,
      description: description.trim(),
    });
  };

  const isValid = name.trim().length > 0 && name.trim().length <= 80;

  return (
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

      <div className="mb-3">
        <label className="form-label fw-semibold">Type</label>
        <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
          {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="mb-4">
        <label className="form-label fw-semibold">
          Description <span className="text-muted fw-normal">(optional)</span>
        </label>
        <textarea
          className="form-control"
          rows={3}
          maxLength={300}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="A short description of this group..."
        />
        <div className="form-text">{description.length}/300</div>
      </div>

      <button type="submit" className="btn btn-sl btn-lg w-100" disabled={!isValid || loading}>
        {loading ? (
          <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</>
        ) : submitLabel}
      </button>
    </form>
  );
}
