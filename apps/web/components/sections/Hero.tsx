import Image from 'next/image';
import VideoBackground from '@/components/ui/VideoBackground';

interface HeroProps {
  firstName: string;
  lastName: string;
}

export default function Hero({ firstName, lastName }: HeroProps) {
  return (
    <section
      className="relative flex h-dvh items-center overflow-hidden bg-ink"
      aria-labelledby="hero-heading"
    >
      <VideoBackground />
      <div className="relative z-10 mx-auto grid w-full max-w-[var(--width-content)] grid-cols-1 gap-12 px-[var(--spacing-gutter)] lg:grid-cols-3 lg:items-center">
        {/* Left — greeting */}
        <div className="lg:col-span-2">
          <h1
            id="hero-heading"
            className="font-heading text-4xl font-medium leading-tight text-parchment sm:text-5xl lg:text-6xl"
          >
            Welcome
            <br />
            {firstName} {lastName}.
          </h1>
          <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-parchment/60">
            We will introduce you to our demo application and its ecosystem experience.
          </p>
        </div>

        {/* Right — memorial photo */}
        <div className="flex flex-col items-center gap-4 lg:col-span-1 lg:items-end">
          <div className="relative h-56 w-64 overflow-hidden rounded-md sm:h-72 sm:w-80">
            <Image
              src="/images/hero-onboard.jpeg"
              alt="Andy Warhol, Jean-Michel Basquiat, and Keith Haring"
              fill
              priority
              className="object-cover"
            />
          </div>
          <p className="max-w-[20rem] text-center font-body text-xs leading-relaxed text-parchment/40 lg:text-right">
            In memory of the friendship between Andy Warhol, Jean-Michel Basquiat, and Keith Haring.
          </p>
        </div>
      </div>
    </section>
  );
}
