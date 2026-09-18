import { type NextPage } from 'next';
import Link from 'next/link';

import { env } from '~/env';

const Privacy: NextPage<{ feedbackEmail: string }> = ({ feedbackEmail }) => (
  <>
    <div>
      <main className="mx-auto max-w-4xl px-4 pb-32 lg:px-0">
        <nav className="sticky mx-auto flex max-w-5xl items-center justify-between px-4 py-4 lg:px-0 lg:py-5">
          <Link href="/">
            <div className="flex items-center gap-2">
              <p className="text-2xl font-medium">SplitPro</p>
            </div>
          </Link>
        </nav>
        <h1 className="mt-20 text-2xl font-semibold">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">Last Updated: 06 Mar, 2022</p>

        <p className="text-muted-foreground mt-4 text-lg">
          Splitpro is committed to protecting your privacy. This Privacy Policy outlines how we
          collect, use, and disclose your information when you use Splitpro.
        </p>

        <p className="mt-16 text-xl font-semibold">Information We Collect</p>
        <p className="text-foreground mt-4 text-lg">Personal Information</p>
        <p className="text-muted-foreground mt-0.5 text-lg">
          When you create an account, we collect your email address, name, photo (If you choose to
          use continue with google)
        </p>
        <p className="text-foreground mt-4 text-lg">Usage Data</p>
        <p className="text-muted-foreground mt-0.5 text-lg">
          We automatically collect information about how you interact with the Service, such as
          pages visited and features used.
        </p>

        <p className="mt-16 text-xl font-semibold">How We Use Your Information</p>
        <p className="text-muted-foreground mt-1 text-lg">
          We use your information for the following purposes:
          <ul className="list-inside list-disc">
            <li>To provide and maintain the Service</li>
            <li>To improve and personalize your experience with the Service</li>
            <li>To communicate with you about updates, promotions, and customer support</li>
            <li>To show people your name and photo if they have your email id</li>
          </ul>
        </p>
        <p className="mt-16 text-xl font-semibold">Sharing Your Information</p>
        <p className="text-muted-foreground mt-1 text-lg">
          We do not sell, rent, or share your personal information with third parties.
        </p>
        <p className="mt-16 text-xl font-semibold">4. Data Security</p>
        <p className="text-muted-foreground mt-1 text-lg">
          We take reasonable steps to protect your information from unauthorized access, use, or
          disclosure. However, no method of transmission or storage is completely secure, and we
          cannot guarantee the absolute security of your information.
        </p>

        <p className="mt-16 text-xl font-semibold">5. Data Retention</p>
        <p className="text-muted-foreground mt-1 text-lg">
          We retain your personal information for as long as necessary to provide the Service,
          comply with legal obligations, resolve disputes, and enforce our agreements.
        </p>

        <p className="mt-16 text-xl font-semibold">6. Your Rights</p>
        <p className="text-muted-foreground mt-1 text-lg">
          You may access, update, or request the deletion of your personal information by contacting
          us at {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          <a className="underline" href={`mailto:${feedbackEmail}`}>
            {feedbackEmail ?? ''}
          </a>
          .
        </p>

        <p className="mt-16 text-xl font-semibold">7. Children&apos;s Privacy</p>
        <p className="text-muted-foreground mt-1 text-lg">
          The Service is not intended for users under 13 years old. We do not knowingly collect
          personal information from children under 13. If you are a parent or guardian and believe
          your child has provided us with personal information, please contact us at{' '}
          {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          <a className="underline" href={`mailto:${feedbackEmail}`}>
            {feedbackEmail ?? ''}
          </a>
          .
        </p>
        <p className="mt-16 text-xl font-semibold">8. Changes to This Policy</p>
        <p className="text-muted-foreground mt-1 text-lg">
          We may update this Policy from time to time. We will notify you of any changes by posting
          the updated Policy on this page. By continuing to use the Service, you agree to be bound
          by the updated Policy.
        </p>
        <p className="mt-16 text-xl font-semibold">9. Contact</p>
        <p className="text-muted-foreground mt-1 text-lg">
          If you have any questions or concerns regarding these Terms, please contact us at{' '}
          {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          <a className="underline" href={`mailto:${feedbackEmail}`}>
            {feedbackEmail ?? ''}
          </a>
          .
        </p>
      </main>
    </div>
  </>
);

export default Privacy;

export async function getServerSideProps() {
  return {
    props: {
      feedbackEmail: env.FEEDBACK_EMAIL ?? '',
    },
  };
}
