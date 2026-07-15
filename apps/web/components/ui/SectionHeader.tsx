type SectionHeaderProps = {
  eyebrow: string;
  headingId: string;
  title: string;
  description?: string;
  className?: string;
};

export default function SectionHeader({
  eyebrow,
  headingId,
  title,
  description,
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`text-center ${className}`}>
      <span className="block text-xs font-medium uppercase tracking-widest text-flint mb-4">
        {eyebrow}
      </span>
      <h2 id={headingId} className="font-heading text-3xl font-medium text-umber md:text-4xl">
        {title}
      </h2>
      {description && <p className="mt-4 mx-auto max-w-prose text-flint">{description}</p>}
    </div>
  );
}
