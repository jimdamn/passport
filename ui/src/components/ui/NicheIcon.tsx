import {
  Wrench, Hammer, Truck, BookOpen, Leaf, Home,
  Scissors, Laptop, Heart, ShoppingBag, Music, Utensils,
  Car, Paintbrush, Dumbbell, Dog, Baby, Camera, Map,
  type LucideIcon,
} from 'lucide-react';

const NICHE_ICONS: Record<string, LucideIcon> = {
  wrench:   Wrench,
  hammer:   Hammer,
  truck:    Truck,
  book:     BookOpen,
  leaf:     Leaf,
  home:     Home,
  scissors: Scissors,
  laptop:   Laptop,
  heart:    Heart,
  bag:      ShoppingBag,
  music:    Music,
  food:     Utensils,
  car:      Car,
  paint:    Paintbrush,
  fitness:  Dumbbell,
  pet:      Dog,
  baby:     Baby,
  camera:   Camera,
  compass:  Map,
};

export default function NicheIcon({
  name,
  size = 20,
  color = 'var(--amber)',
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const Icon = NICHE_ICONS[name] ?? Wrench;
  return <Icon size={size} strokeWidth={1.75} color={color} />;
}
