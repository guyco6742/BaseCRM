import { useOrg } from '../context/OrgContext'

export default function FavoriteStarButton({ type, boardId }) {
  const { favorite, setFavorite } = useOrg()

  const isActive =
    type === 'clients'
      ? favorite?.type === 'clients'
      : favorite?.type === 'board' && favorite.boardId === boardId

  function toggle() {
    setFavorite(isActive ? null : type === 'board' ? { type: 'board', boardId } : { type: 'clients' })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isActive ? 'הסר מדף הבית של הארגון' : 'הגדר כדף הבית של הארגון'}
      data-testid="favorite-star"
      className={`text-xl leading-none transition-colors ${
        isActive ? 'text-yellow-400' : 'text-text-dim hover:text-yellow-400'
      }`}
    >
      {isActive ? '★' : '☆'}
    </button>
  )
}
