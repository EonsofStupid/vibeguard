/**
 * Page frame: a thin ledger header and a ruled body. Used by every route.
 */

import React from 'react';
import { Link } from 'react-router';
import { useSession } from 'modelence/client';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { Seo, type SeoProps } from '@/client/components/Seo';
import { cn } from '@/client/lib/utils';

interface PageProps {
  children?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
  seo?: SeoProps;
}

const link = 'rounded-sm px-2 py-1 text-sm text-mute underline-offset-4 hover:text-ink hover:underline';

function Header() {
  const { user } = useSession();
  return (
    <header className="border-b border-ink/80 bg-paper">
      <div className="mx-auto flex max-w-[1180px] items-baseline justify-between gap-4 px-4 py-3 md:px-6">
        <Link to="/" className="flex items-baseline gap-3">
          <span className="display text-lg">VibeGuard</span>
          <span className="hidden text-sm text-mute sm:inline">guardrails an AI writes, a human approves</span>
        </Link>
        <nav className="flex items-baseline gap-1">
          <a className={link} href="https://github.com/EonsofStupid/vibeguard" target="_blank" rel="noreferrer">Source</a>
          {user ? (
            <>
              <span className="px-2 text-sm text-pass">signed in as {user.handle}</span>
              <Link to="/logout" className={link}>Sign out</Link>
            </>
          ) : (
            <Link to="/login" className={link}>Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function PageBody({ children, className, isLoading = false }: PageProps) {
  return (
    <main className={cn('mx-auto w-full max-w-[1180px] flex-1 px-4 pb-16 pt-6 md:px-6', className)}>
      {isLoading ? <div className="flex h-full items-center justify-center"><LoadingSpinner /></div> : children}
    </main>
  );
}

export default function Page({ children, className, isLoading = false, seo }: PageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <Seo {...seo} />
      <Header />
      <PageBody className={className} isLoading={isLoading}>{children}</PageBody>
    </div>
  );
}
