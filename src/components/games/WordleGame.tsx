import { useState, useEffect, useCallback } from 'react';

// Target words (answers)
const WORDS = [
  'REACT', 'CLOUD', 'BUILD', 'STACK', 'LOGIC',
  'QUERY', 'FETCH', 'STATE', 'ARRAY', 'CLASS',
  'STYLE', 'THEME', 'PIXEL', 'BRAIN', 'SMART',
  'QUICK', 'SPEED', 'POWER', 'SHIFT', 'SCALE',
  'GRAPH', 'CHART', 'GRACE', 'FLAME', 'STONE',
  'CRANE', 'BLOOM', 'FROST', 'SPARK', 'DRIFT',
  'GLEAM', 'SHARP', 'PLANE', 'TRAIN', 'HOUSE',
  'BREAD', 'LIGHT', 'DREAM', 'OCEAN', 'STORM',
  'VIVID', 'PRIZE', 'WORLD', 'EARTH', 'MUSIC',
  'DANCE', 'LAUGH', 'SMILE', 'HEART', 'PEACE',
];

// Valid guesses — includes targets + common 5-letter English words
const VALID_WORDS = new Set([
  ...WORDS,
  'ABOUT', 'ABOVE', 'ABUSE', 'ACTOR', 'ACUTE', 'ADMIT', 'ADOPT', 'ADULT', 'AFTER', 'AGAIN',
  'AGENT', 'AGREE', 'AHEAD', 'ALARM', 'ALBUM', 'ALERT', 'ALIKE', 'ALIVE', 'ALLOW', 'ALONE',
  'ALONG', 'ALTER', 'AMONG', 'ANGEL', 'ANGER', 'ANGLE', 'ANGRY', 'APART', 'APPLE', 'APPLY',
  'ARENA', 'ARGUE', 'ARISE', 'ASIDE', 'ASSET', 'AVOID', 'AWARD', 'AWARE', 'BADLY', 'BASIC',
  'BASIS', 'BEACH', 'BEGIN', 'BEING', 'BELOW', 'BENCH', 'BIRTH', 'BLACK', 'BLADE', 'BLAME',
  'BLANK', 'BLAST', 'BLAZE', 'BLEED', 'BLEND', 'BLESS', 'BLIND', 'BLOCK', 'BLOOD', 'BOARD',
  'BONUS', 'BOOTH', 'BOUND', 'BRAVE', 'BREAK', 'BREED', 'BRIEF', 'BRING', 'BROAD', 'BROWN',
  'BRUSH', 'BUNCH', 'BURST', 'BUYER', 'CABIN', 'CARRY', 'CATCH', 'CAUSE', 'CHAIN', 'CHAIR',
  'CHAOS', 'CHARM', 'CHASE', 'CHEAP', 'CHECK', 'CHEST', 'CHIEF', 'CHILD', 'CHINA', 'CHORD',
  'CIVIL', 'CLAIM', 'CLASH', 'CLEAN', 'CLEAR', 'CLIMB', 'CLING', 'CLOCK', 'CLOSE', 'CLOTH',
  'COACH', 'COAST', 'COLOR', 'COMET', 'CORAL', 'COULD', 'COUNT', 'COURT', 'COVER', 'CRACK',
  'CRAFT', 'CRASH', 'CRAZY', 'CREAM', 'CRIME', 'CROSS', 'CROWD', 'CROWN', 'CRUEL', 'CRUSH',
  'CURVE', 'CYCLE', 'DAILY', 'DEATH', 'DEBUT', 'DELAY', 'DELTA', 'DENSE', 'DEPTH', 'DEVIL',
  'DIARY', 'DIRTY', 'DOUBT', 'DOZEN', 'DRAFT', 'DRAIN', 'DRAMA', 'DRANK', 'DRAWN', 'DRESS',
  'DRIED', 'DRINK', 'DRIVE', 'DROVE', 'DYING', 'EAGER', 'EARLY', 'EIGHT', 'ELECT', 'ELITE',
  'EMPTY', 'ENEMY', 'ENJOY', 'ENTER', 'ENTRY', 'EQUAL', 'ERROR', 'EVENT', 'EVERY', 'EXACT',
  'EXIST', 'EXTRA', 'FAITH', 'FALSE', 'FANCY', 'FATAL', 'FAULT', 'FEAST', 'FENCE', 'FEWER',
  'FIBER', 'FIELD', 'FIFTH', 'FIFTY', 'FIGHT', 'FINAL', 'FIRST', 'FIXED', 'FLASH', 'FLESH',
  'FLOAT', 'FLOOD', 'FLOOR', 'FLUID', 'FLUSH', 'FOCUS', 'FORCE', 'FORGE', 'FORTH', 'FORUM',
  'FOUND', 'FRAME', 'FRANK', 'FRAUD', 'FRESH', 'FRONT', 'FRUIT', 'FULLY', 'FUNNY', 'GIANT',
  'GIVEN', 'GLASS', 'GLOBE', 'GLOOM', 'GLORY', 'GOING', 'GONNA', 'GRACE', 'GRADE', 'GRAIN',
  'GRAND', 'GRANT', 'GRASP', 'GRASS', 'GRAVE', 'GREAT', 'GREEN', 'GREET', 'GRIEF', 'GRIND',
  'GRIPE', 'GROSS', 'GROUP', 'GROWN', 'GUARD', 'GUESS', 'GUEST', 'GUIDE', 'GUILD', 'GUILT',
  'HAPPY', 'HARSH', 'HAVEN', 'HEAVY', 'HENCE', 'HOBBY', 'HONOR', 'HORSE', 'HOTEL', 'HUMAN',
  'HUMOR', 'IDEAL', 'IMAGE', 'IMPLY', 'INDEX', 'INNER', 'INPUT', 'ISSUE', 'IVORY', 'JOINT',
  'JUDGE', 'JUICE', 'KNOCK', 'KNOWN', 'LABEL', 'LARGE', 'LASER', 'LATER', 'LAUGH', 'LAYER',
  'LEARN', 'LEASE', 'LEAST', 'LEAVE', 'LEGAL', 'LEVEL', 'LEVER', 'LEMON', 'LIMIT', 'LINEN',
  'LIVER', 'LOBBY', 'LOCAL', 'LODGE', 'LONELY','LOOSE', 'LOVER', 'LOWER', 'LUCKY', 'LUNCH',
  'LYING', 'MAGIC', 'MAJOR', 'MAKER', 'MANOR', 'MAPLE', 'MARCH', 'MATCH', 'MAYOR', 'MEDIA',
  'MERCY', 'MERIT', 'METAL', 'MIGHT', 'MINOR', 'MINUS', 'MODEL', 'MONEY', 'MONTH', 'MORAL',
  'MOUNT', 'MOUSE', 'MOUTH', 'MOVIE', 'MULTI', 'NAIVE', 'NASTY', 'NAVAL', 'NERVE', 'NEVER',
  'NEWLY', 'NIGHT', 'NOBLE', 'NOISE', 'NOTED', 'NOVEL', 'NURSE', 'OCCUR', 'OCEAN', 'OFFER',
  'OFTEN', 'ONSET', 'OPERA', 'ORDER', 'OTHER', 'OUGHT', 'OUTER', 'OWNER', 'OXIDE', 'PAINT',
  'PANEL', 'PANIC', 'PAPER', 'PARTY', 'PATCH', 'PAUSE', 'PEACE', 'PENNY', 'PHASE', 'PHONE',
  'PHOTO', 'PIANO', 'PIECE', 'PILOT', 'PITCH', 'PLACE', 'PLAIN', 'PLANT', 'PLATE', 'PLAZA',
  'PLEAD', 'PLOT', 'PLUMB', 'POINT', 'POLAR', 'POUND', 'PRESS', 'PRICE', 'PRIDE', 'PRIME',
  'PRINT', 'PRIOR', 'PROBE', 'PROOF', 'PROUD', 'PROVE', 'PROXY', 'PUPIL', 'QUEEN', 'QUEST',
  'QUIET', 'QUITE', 'QUOTA', 'QUOTE', 'RADAR', 'RADIO', 'RAISE', 'RANGE', 'RAPID', 'RATIO',
  'REACH', 'READY', 'REALM', 'REBEL', 'REFER', 'REIGN', 'RELAX', 'REPLY', 'RIDER', 'RIDGE',
  'RIFLE', 'RIGHT', 'RIGID', 'RISKY', 'RIVAL', 'RIVER', 'ROBIN', 'ROBOT', 'ROCKY', 'ROGER',
  'ROMAN', 'ROUGH', 'ROUND', 'ROUTE', 'ROYAL', 'RUGBY', 'RULER', 'RURAL', 'SAINT', 'SALAD',
  'SAUCE', 'SCALD', 'SCENE', 'SCOPE', 'SCORE', 'SENSE', 'SERVE', 'SETUP', 'SEVEN', 'SHALL',
  'SHAME', 'SHAPE', 'SHARE', 'SHARK', 'SHEEP', 'SHEER', 'SHEET', 'SHELF', 'SHELL', 'SHIFT',
  'SHINE', 'SHIRT', 'SHOCK', 'SHOOT', 'SHORT', 'SHOUT', 'SIGHT', 'SILLY', 'SINCE', 'SIXTH',
  'SIXTY', 'SIZED', 'SKILL', 'SLEEP', 'SLICE', 'SLIDE', 'SMALL', 'SMELL', 'SMOKE', 'SOLAR',
  'SOLID', 'SOLVE', 'SORRY', 'SOUND', 'SOUTH', 'SPACE', 'SPARE', 'SPEAK', 'SPEED', 'SPEND',
  'SPENT', 'SPILL', 'SPINE', 'SPITE', 'SPLIT', 'SPOKE', 'SPORT', 'SPRAY', 'SQUAD', 'STAFF',
  'STAGE', 'STAIN', 'STAKE', 'STALE', 'STALL', 'STAND', 'STARE', 'START', 'STEAM', 'STEEL',
  'STEEP', 'STEER', 'STERN', 'STICK', 'STIFF', 'STILL', 'STOCK', 'STOLE', 'STORE', 'STORY',
  'STRIP', 'STUCK', 'STUDY', 'STUFF', 'SUGAR', 'SUITE', 'SUPER', 'SURGE', 'SWAMP', 'SWEAR',
  'SWEEP', 'SWEET', 'SWEPT', 'SWING', 'SWORD', 'SWORE', 'SWORN', 'TABLE', 'TASTE', 'TEACH',
  'TEETH', 'TEMPO', 'TENSE', 'TENTH', 'THANK', 'THEFT', 'THEIR', 'THERE', 'THICK', 'THING',
  'THINK', 'THIRD', 'THOSE', 'THREE', 'THREW', 'THROW', 'THUMB', 'TIDAL', 'TIGHT', 'TIMER',
  'TIRED', 'TITLE', 'TODAY', 'TOKEN', 'TOPIC', 'TOTAL', 'TOUCH', 'TOUGH', 'TOWER', 'TOXIC',
  'TRACE', 'TRACK', 'TRADE', 'TRAIL', 'TRAIT', 'TRASH', 'TREAT', 'TREND', 'TRIAL', 'TRIBE',
  'TRICK', 'TRIED', 'TROOP', 'TRUCK', 'TRULY', 'TRUMP', 'TRUNK', 'TRUST', 'TRUTH', 'TUMOR',
  'TWICE', 'TWIST', 'ULTRA', 'UNCLE', 'UNDER', 'UNFIT', 'UNION', 'UNITE', 'UNITY', 'UNTIL',
  'UPPER', 'UPSET', 'URBAN', 'USAGE', 'USUAL', 'UTTER', 'VALID', 'VALUE', 'VIDEO', 'VIGOR',
  'VIRAL', 'VIRUS', 'VISIT', 'VISTA', 'VITAL', 'VOCAL', 'VODKA', 'VOICE', 'VOTER', 'WAGON',
  'WASTE', 'WATCH', 'WATER', 'WEAVE', 'WEIGH', 'WEIRD', 'WHEEL', 'WHERE', 'WHICH', 'WHILE',
  'WHITE', 'WHOLE', 'WHOSE', 'WIDER', 'WOMAN', 'WOMEN', 'WORLD', 'WORRY', 'WORSE', 'WORST',
  'WORTH', 'WOULD', 'WOUND', 'WRITE', 'WRONG', 'WROTE', 'YACHT', 'YIELD', 'YOUNG', 'YOUTH',
  'ASYNC', 'AWAIT', 'CACHE', 'CONST', 'DEBUG', 'FETCH', 'HOOKS', 'NEXTS', 'NODES', 'PARSE',
  'PATHS', 'PROPS', 'ROUTE', 'TYPES',
]);

type LetterState = 'correct' | 'present' | 'absent' | 'empty';

interface TileData {
  letter: string;
  state: LetterState;
}

export function WordleGame() {
  const [targetWord, setTargetWord] = useState('');
  const [guesses, setGuesses] = useState<TileData[][]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [usedLetters, setUsedLetters] = useState<Record<string, LetterState>>({});
  const [shake, setShake] = useState(false);

  const initGame = useCallback(() => {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    setTargetWord(word);
    setGuesses([]);
    setCurrentGuess('');
    setGameOver(false);
    setWon(false);
    setUsedLetters({});
  }, []);

  useEffect(() => {
    initGame();
  }, [initGame]);

  const evaluateGuess = useCallback((guess: string): TileData[] => {
    const result: TileData[] = [];
    const targetLetters = targetWord.split('');
    const guessLetters = guess.split('');
    const used = new Array(5).fill(false);

    // First pass: mark correct letters
    for (let i = 0; i < 5; i++) {
      if (guessLetters[i] === targetLetters[i]) {
        result[i] = { letter: guessLetters[i], state: 'correct' };
        used[i] = true;
      } else {
        result[i] = { letter: guessLetters[i], state: 'absent' };
      }
    }

    // Second pass: mark present letters
    for (let i = 0; i < 5; i++) {
      if (result[i].state !== 'correct') {
        for (let j = 0; j < 5; j++) {
          if (!used[j] && guessLetters[i] === targetLetters[j]) {
            result[i].state = 'present';
            used[j] = true;
            break;
          }
        }
      }
    }

    return result;
  }, [targetWord]);

  const [message, setMessage] = useState('');
  
  const submitGuess = useCallback(() => {
    if (currentGuess.length !== 5) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    if (!VALID_WORDS.has(currentGuess)) {
      setMessage('Not a valid word');
      setShake(true);
      setTimeout(() => { setShake(false); setMessage(''); }, 1200);
      return;
    }

    const evaluation = evaluateGuess(currentGuess);
    setGuesses(prev => [...prev, evaluation]);

    // Update used letters
    const newUsed = { ...usedLetters };
    evaluation.forEach(tile => {
      const current = newUsed[tile.letter];
      if (tile.state === 'correct' || (tile.state === 'present' && current !== 'correct')) {
        newUsed[tile.letter] = tile.state;
      } else if (!current) {
        newUsed[tile.letter] = tile.state;
      }
    });
    setUsedLetters(newUsed);

    if (currentGuess === targetWord) {
      setWon(true);
      setGameOver(true);
    } else if (guesses.length >= 5) {
      setGameOver(true);
    }

    setCurrentGuess('');
  }, [currentGuess, evaluateGuess, guesses.length, targetWord, usedLetters]);

  const handleKey = useCallback((key: string) => {
    if (gameOver) return;

    if (key === 'ENTER') {
      submitGuess();
    } else if (key === 'BACK') {
      setCurrentGuess(prev => prev.slice(0, -1));
    } else if (currentGuess.length < 5 && /^[A-Z]$/.test(key)) {
      setCurrentGuess(prev => prev + key);
    }
  }, [currentGuess.length, gameOver, submitGuess]);

  // Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleKey('ENTER');
      } else if (e.key === 'Backspace') {
        handleKey('BACK');
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        handleKey(e.key.toUpperCase());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKey]);

  const KEYBOARD = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK'],
  ];

  const getTileColor = (state: LetterState) => {
    switch (state) {
      case 'correct': return 'bg-[#22c55e] border-[#22c55e]';
      case 'present': return 'bg-[#eab308] border-[#eab308]';
      case 'absent': return 'bg-[#3a3a45] border-[#3a3a45]';
      default: return 'bg-transparent border-[#3a3a45]';
    }
  };

  const getKeyColor = (letter: string) => {
    const state = usedLetters[letter];
    switch (state) {
      case 'correct': return 'bg-[#22c55e]';
      case 'present': return 'bg-[#eab308]';
      case 'absent': return 'bg-[#3a3a45]';
      default: return 'bg-[#52525b]';
    }
  };

  // Build display rows (6 total)
  const displayRows: TileData[][] = [];
  for (let i = 0; i < 6; i++) {
    if (i < guesses.length) {
      displayRows.push(guesses[i]);
    } else if (i === guesses.length && !gameOver) {
      // Current guess row
      const row: TileData[] = [];
      for (let j = 0; j < 5; j++) {
        row.push({
          letter: currentGuess[j] || '',
          state: 'empty',
        });
      }
      displayRows.push(row);
    } else {
      // Empty row
      displayRows.push(Array(5).fill({ letter: '', state: 'empty' }));
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Grid */}
      <div className={`flex flex-col gap-1 ${shake ? 'animate-shake' : ''}`}>
        {displayRows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((tile, colIndex) => (
              <div
                key={colIndex}
                className={`w-9 h-9 flex items-center justify-center border-2 text-sm font-bold text-white transition-all ${getTileColor(tile.state)}`}
              >
                {tile.letter}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Invalid word message */}
      {message && (
        <p className="text-xs text-[#ef4444] font-bold">{message}</p>
      )}

      {/* Game over message */}
      {gameOver && (
        <div className="text-center">
          <p className={`text-sm font-bold ${won ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
            {won ? 'Nice!' : `It was: ${targetWord}`}
          </p>
          <button
            onClick={initGame}
            className="text-xs text-[#6366f1] hover:underline mt-1"
          >
            Play Again
          </button>
        </div>
      )}

      {/* Keyboard */}
      <div className="flex flex-col gap-1">
        {KEYBOARD.map((row, rowIndex) => (
          <div key={rowIndex} className="flex justify-center gap-0.5">
            {row.map(key => (
              <button
                key={key}
                onClick={() => handleKey(key)}
                className={`${
                  key === 'ENTER' || key === 'BACK' ? 'px-2 text-[10px]' : 'w-6 text-xs'
                } h-8 rounded font-bold text-white transition-colors hover:opacity-80 ${getKeyColor(key)}`}
              >
                {key === 'BACK' ? '←' : key}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
