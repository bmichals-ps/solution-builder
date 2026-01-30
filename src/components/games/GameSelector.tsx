import { useState } from 'react';
import { SnakeGame } from './SnakeGame';
import { PacmanGame } from './PacmanGame';
import { WordleGame } from './WordleGame';
import { BrickBreakerGame } from './BrickBreakerGame';

type GameType = 'snake' | 'pacman' | 'wordle' | 'bricks';

interface GameOption {
  id: GameType;
  name: string;
  icon: string;
  color: string;
}

const GAMES: GameOption[] = [
  { id: 'snake', name: 'Snake', icon: '🐍', color: '#22c55e' },
  { id: 'pacman', name: 'Pacman', icon: '👾', color: '#facc15' },
  { id: 'wordle', name: 'Wordle', icon: '📝', color: '#6366f1' },
  { id: 'bricks', name: 'Bricks', icon: '🧱', color: '#ef4444' },
];

export function GameSelector() {
  const [selectedGame, setSelectedGame] = useState<GameType | null>(null);

  const renderGame = () => {
    switch (selectedGame) {
      case 'snake': return <SnakeGame />;
      case 'pacman': return <PacmanGame />;
      case 'wordle': return <WordleGame />;
      case 'bricks': return <BrickBreakerGame />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col items-center w-full">
      {/* Header */}
      <div className="text-center mb-5">
        <h3 className="text-sm font-medium text-white mb-1">
          Play while you wait
        </h3>
        <p className="text-xs text-[#6a6a75]">
          {selectedGame ? 'Press SPACE to pause/restart' : 'Choose a game below'}
        </p>
      </div>

      {/* Game Selection */}
      <div className="grid grid-cols-4 gap-3 mb-5 w-full max-w-xs">
        {GAMES.map(game => (
          <button
            key={game.id}
            onClick={() => setSelectedGame(game.id)}
            className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
              selectedGame === game.id
                ? 'border-[#6366f1] bg-[#6366f1]/10 shadow-lg shadow-[#6366f1]/10'
                : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
            }`}
          >
            <span className="text-2xl mb-1">{game.icon}</span>
            <span className="text-[10px] text-[#8585a3] font-medium">{game.name}</span>
          </button>
        ))}
      </div>

      {/* Game Container */}
      <div className="bg-[#0a0a0f] rounded-xl border border-white/[0.08] p-5 min-h-[320px] w-full max-w-xs flex items-center justify-center">
        {selectedGame ? (
          renderGame()
        ) : (
          <div className="text-center text-[#4a4a55]">
            <div className="text-5xl mb-3 opacity-50">🎮</div>
            <p className="text-sm">Select a game to play</p>
          </div>
        )}
      </div>

      {/* Back button when game is selected */}
      {selectedGame && (
        <button
          onClick={() => setSelectedGame(null)}
          className="mt-4 text-xs text-[#6a6a75] hover:text-white transition-colors"
        >
          ← Choose different game
        </button>
      )}
    </div>
  );
}
