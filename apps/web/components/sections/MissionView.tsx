import type { Stage } from '@/lib/services/auth';
import VideoBackground from '@/components/ui/VideoBackground';

type MissionState = 'completed' | 'in_progress' | 'locked';

interface MissionViewProps {
  stage: Stage | null;
}

export default function MissionView({ stage }: MissionViewProps) {
  if (!stage) {
    return (
      <section className="relative flex h-dvh items-center overflow-hidden bg-ink">
        <VideoBackground />
        <div className="relative z-10 mx-auto w-full max-w-[var(--width-content)] px-[var(--spacing-gutter)]">
          <p className="font-body text-xs font-semibold uppercase tracking-widest text-ochre">
            Missions
          </p>
          <h1 className="mt-3 font-heading text-4xl font-medium leading-tight text-parchment sm:text-5xl lg:text-6xl">
            Coming Soon
          </h1>
          <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-parchment/60">
            Your missions are not available yet. Check back soon.
          </p>
        </div>
      </section>
    );
  }

  const missions = Array.from({ length: stage.totalMissions }, (_, i) => {
    const position = i + 1;
    let state: MissionState;
    if (position <= stage.completedMissions) {
      state = 'completed';
    } else if (position === stage.completedMissions + 1 && !stage.isCompleted) {
      state = 'in_progress';
    } else {
      state = 'locked';
    }
    return { position, state };
  });

  const currentLabel = stage.isCompleted
    ? 'Completed'
    : `${stage.completedMissions} of ${stage.totalMissions} completed`;

  return (
    <section
      className="relative flex h-dvh items-center overflow-hidden bg-ink"
      aria-labelledby="mission-heading"
    >
      <VideoBackground />

      <div className="relative z-10 mx-auto grid w-full max-w-[var(--width-content)] grid-cols-1 gap-12 px-[var(--spacing-gutter)] lg:grid-cols-3 lg:items-center">
        {/* Left — stage content */}
        <div className="lg:col-span-2">
          <p className="font-body text-xs font-semibold uppercase tracking-widest text-ochre">
            Stage {String(stage.order).padStart(2, '0')}
          </p>
          <h1
            id="mission-heading"
            className="mt-3 font-heading text-4xl font-medium leading-tight text-parchment sm:text-5xl lg:text-6xl"
          >
            {stage.title}
          </h1>
          <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-parchment/60">
            {stage.description}
          </p>
          <StatusBadge isCompleted={stage.isCompleted} />
          <p className="mt-3 font-body text-xs text-parchment/40">{currentLabel}</p>
        </div>

        {/* Right — mission progress indicators */}
        <div
          className="flex gap-6 lg:col-span-1 lg:flex-col lg:items-end lg:gap-8"
          role="list"
          aria-label="Mission progress"
        >
          {missions.map(({ position, state }) => (
            <MissionIndicator key={position} position={position} state={state} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ isCompleted }: { isCompleted: boolean }) {
  return (
    <span
      className={`mt-6 inline-block rounded-full border px-4 py-1.5 font-body text-xs font-medium uppercase tracking-wider ${
        isCompleted
          ? 'border-parchment/30 text-parchment/60'
          : 'border-ochre text-ochre'
      }`}
    >
      {isCompleted ? 'Completed' : 'In Progress'}
    </span>
  );
}

function MissionIndicator({
  position,
  state,
}: {
  position: number;
  state: MissionState;
}) {
  const label = String(position).padStart(2, '0');

  const styles: Record<MissionState, string> = {
    completed: 'border border-parchment/30 text-parchment/60',
    in_progress: 'bg-ochre text-ink',
    locked: 'border border-parchment/10 text-parchment/20',
  };

  return (
    <span
      role="listitem"
      aria-label={`Mission ${label} — ${state.replace('_', ' ')}`}
      className={`flex h-12 w-12 items-center justify-center rounded-full font-body text-sm font-medium ${styles[state]}`}
    >
      {label}
    </span>
  );
}
