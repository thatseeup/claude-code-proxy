import { NavLink } from "@remix-run/react";

export default function TopNav() {
  const linkBase =
    "px-3 py-1.5 text-sm font-medium rounded transition-colors";
  const activeClass = "bg-white text-gray-900 shadow-sm";
  const inactiveClass = "text-gray-600 hover:text-gray-900";

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h1 className="text-lg font-semibold text-gray-900">
            Claude Code Monitor
          </h1>
        </div>
        <nav className="inline-flex items-center bg-gray-100 rounded p-0.5 space-x-0.5">
          <NavLink
            to="/requests"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? activeClass : inactiveClass}`
            }
          >
            Requests
          </NavLink>
          <NavLink
            to="/conversations"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? activeClass : inactiveClass}`
            }
          >
            Conversations
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
