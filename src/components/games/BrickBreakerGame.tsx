import { useEffect, useRef, useState, useCallback } from 'react';

const CANVAS_WIDTH = 300;
const CANVAS_HEIGHT = 300;
const PADDLE_WIDTH = 60;
const PADDLE_HEIGHT = 10;
const BALL_SIZE = 8;
const BRICK_ROWS = 5;
const BRICK_COLS = 8;
const BRICK_WIDTH = 34;
const BRICK_HEIGHT = 12;
const BRICK_PADDING = 2;
const BRICK_OFFSET_TOP = 30;
const BRICK_OFFSET_LEFT = 5;

interface Brick {
  x: number;
  y: number;
  alive: boolean;
  color: string;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4'];

export function BrickBreakerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paddleX, setPaddleX] = useState(CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2);
  const [ballPos, setBallPos] = useState({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40 });
  const [bricks, setBricks] = useState<Brick[]>([]);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  
  const paddleRef = useRef(paddleX);
  paddleRef.current = paddleX;
  
  // Use refs for ball physics to avoid stale closure issues in game loop
  const ballPosRef = useRef({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40 });
  const ballVelRef = useRef({ x: 3, y: -3 });

  const initBricks = useCallback(() => {
    const newBricks: Brick[] = [];
    for (let row = 0; row < BRICK_ROWS; row++) {
      for (let col = 0; col < BRICK_COLS; col++) {
        newBricks.push({
          x: BRICK_OFFSET_LEFT + col * (BRICK_WIDTH + BRICK_PADDING),
          y: BRICK_OFFSET_TOP + row * (BRICK_HEIGHT + BRICK_PADDING),
          alive: true,
          color: COLORS[row % COLORS.length],
        });
      }
    }
    return newBricks;
  }, []);

  const resetGame = useCallback(() => {
    setPaddleX(CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2);
    ballPosRef.current = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40 };
    ballVelRef.current = { x: 3, y: -3 };
    setBallPos({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40 });
    setBricks(initBricks());
    setScore(0);
    setLives(3);
    setGameOver(false);
    setWon(false);
    setIsPaused(false);
  }, [initBricks]);

  // Initialize bricks on mount
  useEffect(() => {
    setBricks(initBricks());
  }, [initBricks]);

  // Handle keyboard and mouse input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setPaddleX(prev => Math.max(0, prev - 20));
        if (isPaused && !gameOver) setIsPaused(false);
      } else if (e.key === 'ArrowRight') {
        setPaddleX(prev => Math.min(CANVAS_WIDTH - PADDLE_WIDTH, prev + 20));
        if (isPaused && !gameOver) setIsPaused(false);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (gameOver) {
          resetGame();
        } else {
          setIsPaused(p => !p);
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      setPaddleX(Math.max(0, Math.min(CANVAS_WIDTH - PADDLE_WIDTH, mouseX - PADDLE_WIDTH / 2)));
      if (isPaused && !gameOver) setIsPaused(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    const canvas = canvasRef.current;
    canvas?.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      canvas?.removeEventListener('mousemove', handleMouseMove);
    };
  }, [gameOver, isPaused, resetGame]);

  // Game loop — uses refs for ball physics to avoid stale closures
  useEffect(() => {
    if (isPaused || gameOver) return;

    const gameLoop = () => {
      const pos = ballPosRef.current;
      const vel = ballVelRef.current;
      
      let newX = pos.x + vel.x;
      let newY = pos.y + vel.y;
      let newVelX = vel.x;
      let newVelY = vel.y;

      // Wall collisions
      if (newX <= BALL_SIZE / 2 || newX >= CANVAS_WIDTH - BALL_SIZE / 2) {
        newVelX = -newVelX;
        newX = pos.x + newVelX;
      }
      if (newY <= BALL_SIZE / 2) {
        newVelY = -newVelY;
        newY = pos.y + newVelY;
      }

      // Paddle collision
      const paddleTop = CANVAS_HEIGHT - 20;
      if (
        newY >= paddleTop - BALL_SIZE / 2 &&
        newY <= paddleTop + PADDLE_HEIGHT &&
        newX >= paddleRef.current &&
        newX <= paddleRef.current + PADDLE_WIDTH
      ) {
        newVelY = -Math.abs(newVelY);
        // Add angle based on where ball hits paddle
        const hitPos = (newX - paddleRef.current) / PADDLE_WIDTH;
        newVelX = (hitPos - 0.5) * 6;
        // Ensure minimum vertical speed
        if (Math.abs(newVelY) < 2) newVelY = newVelY < 0 ? -2 : 2;
        newY = paddleTop - BALL_SIZE / 2 - 1;
      }

      // Ball falls off bottom
      if (newY >= CANVAS_HEIGHT) {
        setLives(l => {
          const newLives = l - 1;
          if (newLives <= 0) {
            setGameOver(true);
          }
          return newLives;
        });
        // Reset ball
        ballPosRef.current = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40 };
        ballVelRef.current = { x: 3, y: -3 };
        setBallPos({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40 });
        return;
      }

      // Brick collisions
      setBricks(prevBricks => {
        let hitBrick = false;
        const newBricks = prevBricks.map(brick => {
          if (!brick.alive || hitBrick) return brick;
          
          if (
            newX + BALL_SIZE / 2 >= brick.x &&
            newX - BALL_SIZE / 2 <= brick.x + BRICK_WIDTH &&
            newY + BALL_SIZE / 2 >= brick.y &&
            newY - BALL_SIZE / 2 <= brick.y + BRICK_HEIGHT
          ) {
            hitBrick = true;
            setScore(s => s + 10);
            
            // Determine bounce direction based on collision side
            const overlapLeft = (newX + BALL_SIZE / 2) - brick.x;
            const overlapRight = (brick.x + BRICK_WIDTH) - (newX - BALL_SIZE / 2);
            const overlapTop = (newY + BALL_SIZE / 2) - brick.y;
            const overlapBottom = (brick.y + BRICK_HEIGHT) - (newY - BALL_SIZE / 2);
            const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
            
            if (minOverlap === overlapTop || minOverlap === overlapBottom) {
              newVelY = -newVelY;
            } else {
              newVelX = -newVelX;
            }
            
            return { ...brick, alive: false };
          }
          return brick;
        });

        if (newBricks.every(b => !b.alive)) {
          setWon(true);
          setGameOver(true);
        }

        return newBricks;
      });

      // Update refs and state
      ballVelRef.current = { x: newVelX, y: newVelY };
      ballPosRef.current = { x: newX, y: newY };
      setBallPos({ x: newX, y: newY });
    };

    const interval = setInterval(gameLoop, 16);
    return () => clearInterval(interval);
  }, [isPaused, gameOver]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw bricks
    bricks.forEach(brick => {
      if (!brick.alive) return;
      ctx.fillStyle = brick.color;
      ctx.shadowColor = brick.color;
      ctx.shadowBlur = 4;
      ctx.fillRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);
      ctx.shadowBlur = 0;
    });

    // Draw paddle
    ctx.fillStyle = '#a5b4fc';
    ctx.shadowColor = '#a5b4fc';
    ctx.shadowBlur = 8;
    ctx.fillRect(paddleX, CANVAS_HEIGHT - 20, PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.shadowBlur = 0;

    // Draw ball
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ballPos.x, ballPos.y, BALL_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw lives indicator
    for (let i = 0; i < lives; i++) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(15 + i * 15, 15, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw game over or paused overlay
    if (gameOver || isPaused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      
      if (gameOver) {
        ctx.fillStyle = won ? '#22c55e' : '#ef4444';
        ctx.fillText(won ? 'YOU WIN!' : 'GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.fillText('Press SPACE to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 15);
      } else {
        ctx.fillText('PAUSED', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
        ctx.font = '12px monospace';
        ctx.fillText('Move mouse or arrows', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 15);
      }
    }
  }, [paddleX, ballPos, bricks, lives, gameOver, won, isPaused]);

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="border border-white/10 rounded-lg cursor-none"
      />
      <div className="flex items-center justify-between w-full px-2">
        <span className="text-xs text-[#a5b4fc] font-mono">Score: {score}</span>
        <span className="text-xs text-[#6a6a75] font-mono">Lives: {lives}</span>
      </div>
    </div>
  );
}
