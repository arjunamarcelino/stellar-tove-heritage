'use client';

import {
  ClipboardCheck,
  FileText,
  Gavel,
  LayoutDashboard,
  Palette,
  Rocket,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';

const baseNavItems = [
  { title: 'Dashboard', href: '/', icon: LayoutDashboard },
  { title: 'Missions', href: '/missions', icon: Rocket },
  { title: 'Artworks', href: '/artworks', icon: Palette },
  { title: 'Offerings', href: '/offerings', icon: Gavel },
  { title: 'Submissions', href: '/submissions', icon: ClipboardCheck },
  { title: 'Users', href: '/users', icon: Users },
  { title: 'KYC Allowlist', href: '/kyc/allowlist', icon: Wallet },
];

const superadminNavItems = [
  { title: 'Admin', href: '/admins', icon: ShieldCheck },
  { title: 'Files', href: '/files', icon: FileText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();

  const navItems =
    user?.role === 'superadmin' ? [...baseNavItems, ...superadminNavItems] : baseNavItems;

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-6 py-4">
        <Link href="/" className="text-lg font-semibold">
          Tove Backoffice
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <SidebarMenuItem key={i}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <Skeleton className="size-4" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </SidebarMenuItem>
                  ))}
                </>
              ) : (
                navItems.map((item) => {
                  const isActive =
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<Link href={item.href} />}
                      >
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
