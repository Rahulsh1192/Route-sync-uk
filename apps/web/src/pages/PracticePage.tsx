import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Instruction, PracticeRoute, RouteDetail } from '../api/types';
import { useWatchTime } from '../player/useWatchTime';
import { InstructorByline } from '../components/InstructorByline';

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  u.rate = 0.95;
  const gb = window.speechSynthesis.getVoices().find((v) => v.lang === 'en-GB');
  if (gb) u.voice = gb;
  window.speechSynthesis.speak(u);
}

function icon(type: string): string {
  if (type.includes('roundabout')) return '🔄';
  if (type.includes('left')) return '↰';
  if (type.includes('right')) return '↱';
  if (type === 'destination') return '🏁';
  if (type === 'start') return '📍';
  return '↑';
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [route, setRoute] = useState<PracticeRoute | null>(null);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [next, setNext] = useState(0);

  const timer = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const nextRef = useRef(0);

  // Report practice time to the rev-share engine while a run is in progress.
  useWatchTime(id, 'practice', running);

  useEffect(() => {
    api.practice(id!).then(setRoute).catch((e) => {
      // Deep-linked here without access: route detail runs the per-centre paywall flow.
      if (e instanceof ApiError && e.status === 403) {
        nav(`/route/${id}`);
      } else setError((e as Error).message);
    });
    // Instructor info for the "book a lesson" prompt.
    api.route(id!).then(setDetail).catch(() => {});
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      window.speechSynthesis?.cancel();
    };
  }, [id, nav]);

  function start() {
    if (!route) return;
    setRunning(true);
    timer.current = window.setInterval(() => {
      elapsedRef.current += 200;
      setElapsed(elapsedRef.current);
      const ins = route.instructions;
      while (nextRef.current < ins.length && ins[nextRef.current].t_ms <= elapsedRef.current) {
        speak(ins[nextRef.current].text_ukenglish);
        nextRef.current += 1;
        setNext(nextRef.current);
      }
      if (nextRef.current >= ins.length) stop();
    }, 200);
  }

  function stop() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    window.speechSynthesis?.cancel();
    setRunning(false);
  }

  function restart() {
    stop();
    elapsedRef.current = 0;
    nextRef.current = 0;
    setElapsed(0);
    setNext(0);
  }

  if (error) return <div className="error">{error}</div>;
  if (!route) return <div className="center"><div className="spinner" /></div>;

  const upcoming: Instruction | undefined = route.instructions[next];

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 14 }}>
        ← Back
      </button>

      <div className="next-banner">
        <div className="label">NEXT</div>
        <div className="instruction">{upcoming?.text_ukenglish ?? 'Route complete 🎉'}</div>
        {upcoming?.speed_limit_mph != null && (
          <span className="pill amber">{upcoming.speed_limit_mph} mph limit</span>
        )}
        <div className="muted" style={{ marginTop: 8 }}>{fmt(elapsed)}</div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn auto" onClick={running ? stop : start}>
          {running ? '⏸ Pause' : '▶ Start practice'}
        </button>
        <button className="btn secondary auto" onClick={restart}>↺ Restart</button>
      </div>

      <div className="card">
        {route.instructions.map((ins, i) => (
          <div key={ins.seq} className={`instr-item ${i < next ? 'done' : ''}`}>
            <span className="ico">{icon(ins.type)}</span>
            <span style={{ flex: 1 }}>{ins.text_ukenglish}</span>
            <span className="muted" style={{ fontSize: 13 }}>{fmt(ins.t_ms)}</span>
          </div>
        ))}
      </div>

      {detail?.instructorName && (
        <div className="card">
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>RECORDED BY</div>
          <div className="row" style={{ alignItems: 'center' }}>
            <InstructorByline
              id={detail.instructorId}
              name={detail.instructorName}
              avatar={detail.instructorAvatar}
              verified={detail.instructorVerified}
            />
            <div className="spacer" />
            {detail.instructorId && (
              <button className="btn auto" onClick={() => nav(`/instructors/${detail.instructorId}`)}>
                📅 Book a lesson
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
