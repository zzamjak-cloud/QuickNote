// 페이지 icon: 이모지 또는 이미지(quicknote-image:// 등) 표시

import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useImageUrl } from "../../lib/images/hooks";
import { decodeLucidePageIcon, isImageLikePageIcon } from "../../lib/pageIcon";

type Props = {
  icon: string | null;
  className?: string;
  /** img 전용 class (이미지일 때만) */
  imgClassName?: string;
  size?: "sm" | "md" | "lg";
};

const sizeClass: Record<NonNullable<Props["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-10 w-10",
};

export function PageIconDisplay({
  icon,
  className = "",
  imgClassName,
  size = "md",
}: Props) {
  const isImg = isImageLikePageIcon(icon);
  const { url, error } = useImageUrl(isImg ? icon : null);
  const box = sizeClass[size];
  const lucideIcon = decodeLucidePageIcon(icon);
  const iconSize = size === "lg" ? 32 : size === "md" ? 18 : 15;

  if (lucideIcon) {
    const Icon =
      (LucideIcons as unknown as Record<string, LucideIcon>)[
        lucideIcon.name
      ] ?? LucideIcons.FileText;
    return (
      <span className={`inline-flex ${box} shrink-0 items-center justify-center ${className}`}>
        <Icon size={iconSize} strokeWidth={1.9} color={lucideIcon.color} />
      </span>
    );
  }

  if (!icon) {
    return (
      <span className={`inline-flex ${box} shrink-0 items-center justify-center ${className}`}>
        <LucideIcons.FileText
          size={iconSize}
          strokeWidth={1.9}
          className="text-zinc-500 dark:text-zinc-400"
        />
      </span>
    );
  }

  if (isImg && url && !error) {
    return (
      <img
        src={url}
        alt=""
        className={`${box} shrink-0 rounded object-cover ${imgClassName ?? ""} ${className}`}
      />
    );
  }

  if (isImg && !url) {
    return (
      <span
        className={`inline-flex ${box} shrink-0 items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-400 dark:bg-zinc-800 ${className}`}
      >
        …
      </span>
    );
  }

  return (
    <span className={`inline-flex shrink-0 items-center justify-center leading-none ${className}`}>
      {icon}
    </span>
  );
}
