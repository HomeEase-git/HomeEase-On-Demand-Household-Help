import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

export default function MainLayout() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main-wrap">
        <Header />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
