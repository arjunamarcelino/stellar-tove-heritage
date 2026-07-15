export default function VideoBackground() {
  return (
    <>
      <video
        autoPlay
        muted
        loop
        playsInline
        poster="/images/hero-onboard.jpeg"
        preload="metadata"
        className="absolute inset-0 z-0 h-full w-full object-cover opacity-30"
        aria-hidden="true"
      >
        <source src="/videos/hero-onboard.mp4" type="video/mp4" />
      </video>
      <div className="pointer-events-none absolute inset-0 z-[1] bg-ink/40" aria-hidden="true" />
    </>
  );
}
