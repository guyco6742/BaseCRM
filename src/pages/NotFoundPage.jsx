import { Link } from 'react-router-dom'
import Button from '../components/ui/Button'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-5xl font-bold text-text">404</h1>
      <p className="text-text-muted">הדף שחיפשתם לא נמצא.</p>
      <Link to="/">
        <Button>חזרה לדף הבית</Button>
      </Link>
    </div>
  )
}
