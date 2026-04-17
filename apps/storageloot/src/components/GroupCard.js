import { Link } from 'react-router-dom';

const typeLabels = {
  container: 'Container',
  box: 'Box',
  storage: 'Storage Unit',
  garage: 'Garage',
  custom: 'Custom',
};

const typeImages = {
  container: '/groups/container.svg',
  box: '/groups/box.svg',
  storage: '/groups/storage.svg',
  garage: '/groups/garage.svg',
  custom: '/groups/mystery.svg',
};

export default function GroupCard({ group }) {
  const customPhoto = group.photo;
  const image = customPhoto || typeImages[group.type] || typeImages.custom;
  const label = typeLabels[group.type] || 'Custom';

  return (
    <Link to={`/group/${group.id}`} className="text-decoration-none">
      <div className="card group-card h-100">
        <img
          src={image}
          alt={label}
          className="card-img-top"
          style={customPhoto ? undefined : { objectFit: 'contain', padding: '1rem', background: '#f8f9fa' }}
        />
        <div className="card-body">
          <div className="group-name text-dark">{group.name}</div>
          <div className="d-flex gap-1 mt-1">
            <span className="badge bg-light text-dark border">{label}</span>
          </div>
          <div className="text-muted small mt-1">
            by {group.ownerDisplayName || 'Anonymous'}
          </div>
        </div>
      </div>
    </Link>
  );
}
