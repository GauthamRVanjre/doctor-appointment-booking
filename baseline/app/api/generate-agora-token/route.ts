import { NextRequest, NextResponse } from 'next/server';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { demoEnabled, deployedDemo, bootstrapCookie, ownsBootstrap } from '@/lib/booking/demo-access';

const EXPIRATION_TIME_IN_SECONDS = 3600;

function generateChannelName(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `ai-conversation-${timestamp}-${random}`;
}

export async function GET(request: NextRequest) {
  if (!demoEnabled(request)) return NextResponse.json({ error: 'Demo access unavailable.' },{ status: 403 });
  // console.log('Generating Agora token...');
  const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const APP_CERTIFICATE = process.env.NEXT_AGORA_APP_CERTIFICATE;

  if (!APP_ID || !APP_CERTIFICATE) {
    return NextResponse.json(
      { error: 'Agora credentials are not set' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const uidStr = searchParams.get('uid');
  const parsedUid = uidStr ? parseInt(uidStr, 10) : Number.NaN;
  const uid = Number.isNaN(parsedUid) || parsedUid <= 0
    ? Math.floor(Math.random() * 9_999_000) + 1000
    : parsedUid;
  const channelName = searchParams.get('channel') || generateChannelName();
  if (deployedDemo() && (searchParams.has('channel') || searchParams.has('uid')) && !ownsBootstrap(request,channelName,uid.toString()))
    return NextResponse.json({ error: 'Session ownership required.' },{ status: 403 });

  const expirationTime =
    Math.floor(Date.now() / 1000) + EXPIRATION_TIME_IN_SECONDS;

  try {
    // console.log('Building RTC+RTM token: uid =', uid, 'channel =', channelName);
    const token = RtcTokenBuilder.buildTokenWithRtm(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid.toString(),
      RtcRole.PUBLISHER,
      expirationTime,
      expirationTime,
    );
    // console.log('Token generated successfully (RTC + RTM)');

    const response = NextResponse.json({
      token,
      uid: uid.toString(),
      channel: channelName,
    });
    response.headers.set('Cache-Control','no-store');
    if (deployedDemo() && !searchParams.has('channel')) response.headers.append('Set-Cookie',bootstrapCookie(channelName,uid.toString()));
    return response;
  } catch (error) {
    console.error('Error generating Agora token:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate Agora token',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
