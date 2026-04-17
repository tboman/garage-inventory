import GroupCard from './GroupCard';

export default function GroupGrid({ groups }) {
  if (!groups.length) {
    return (
      <div className="text-center py-5 text-muted">
        <p className="fs-5">No groups yet.</p>
      </div>
    );
  }

  return (
    <div className="listing-grid">
      {groups.map(group => (
        <GroupCard key={group.id} group={group} />
      ))}
    </div>
  );
}
