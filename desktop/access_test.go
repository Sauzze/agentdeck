package desktop

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"

// wrongCode is a code that isn't code.
func wrongCode(code string) string {
	if code == "000000" {
		return "000001"
	}
	return "000000"
}

func TestACodePairsOnePhoneOnce(t *testing.T) {
	isolate(t)
	a := NewAccess()
	code := a.NewCode()
	key, ok := a.Redeem(code, "192.168.1.20", iPhone)
	if !ok || key == "" {
		t.Fatal("the active code didn't pair the phone")
	}
	if phone := a.Phones.WithKey(key); phone == nil || phone.Name != "iPhone" {
		t.Fatalf("the paired phone is %+v, want an iPhone holding the key", phone)
	}
	if _, ok := a.Redeem(code, "192.168.1.21", iPhone); ok {
		t.Fatal("a spent code paired a second phone")
	}
}

func TestNoCodeUntilOneIsAskedFor(t *testing.T) {
	isolate(t)
	a := NewAccess()
	if a.ActiveCode() != "" {
		t.Fatal("a code exists before anyone asked for one")
	}
	if _, ok := a.Redeem("000000", "192.168.1.20", iPhone); ok {
		t.Fatal("a phone paired with no code asked for")
	}
}

func TestACodeRunsOut(t *testing.T) {
	isolate(t)
	a := NewAccess()
	code := a.NewCode()
	a.codeExpiry = time.Now().Add(-time.Second)
	if a.ActiveCode() != "" {
		t.Fatal("an expired code is still active")
	}
	if _, ok := a.Redeem(code, "192.168.1.20", iPhone); ok {
		t.Fatal("an expired code paired a phone")
	}
}

func TestWrongCodesLockOutTheAddressTheyCameFrom(t *testing.T) {
	isolate(t)
	a := NewAccess()
	code := a.NewCode()
	for range maxAttemptsPerAddress {
		a.Redeem(wrongCode(code), "192.168.1.66", "")
	}
	if _, ok := a.Redeem(code, "192.168.1.66", ""); ok {
		t.Fatal("a locked-out address paired with the right code")
	}
	if _, ok := a.Redeem(code, "192.168.1.20", iPhone); !ok {
		t.Fatal("one address's wrong codes locked out another")
	}
}

func TestTooManyWrongCodesWithdrawTheCode(t *testing.T) {
	isolate(t)
	a := NewAccess()
	code := a.NewCode()
	// A device that changes its address after every guess.
	for i := range maxAttempts {
		a.Redeem(wrongCode(code), fmt.Sprintf("10.0.0.%d", i), "")
	}
	if a.ActiveCode() != "" {
		t.Fatal("the code survived twenty wrong guesses")
	}
	if _, ok := a.Redeem(code, "192.168.1.20", iPhone); ok {
		t.Fatal("a withdrawn code paired a phone")
	}
}

func TestANewCodeLiftsLockouts(t *testing.T) {
	isolate(t)
	a := NewAccess()
	code := a.NewCode()
	for range maxAttemptsPerAddress {
		a.Redeem(wrongCode(code), "192.168.1.66", "")
	}
	if _, ok := a.Redeem(a.NewCode(), "192.168.1.66", iPhone); !ok {
		t.Fatal("a lockout outlived the code it was for")
	}
}

func TestOnlyAHashOfEachKeyIsKept(t *testing.T) {
	isolate(t)
	key := NewAccess().Phones.Pair("iPhone")
	saved, err := os.ReadFile(phonesFile)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(saved), key) {
		t.Fatal("phones.json holds a phone's key")
	}
	if !strings.Contains(string(saved), hashKey(key)) {
		t.Fatal("phones.json doesn't hold the key's hash")
	}
	if loadPhones().WithKey(key) == nil {
		t.Fatal("a phone's key stopped working once saved and loaded again")
	}
}

func TestRevokingAPhoneLeavesTheOthers(t *testing.T) {
	isolate(t)
	phones := NewAccess().Phones
	revoked, kept := phones.Pair("iPhone"), phones.Pair("Android phone")
	phones.Remove(phones.WithKey(revoked).ID)
	if phones.WithKey(revoked) != nil {
		t.Fatal("a revoked phone's key still works")
	}
	if phones.WithKey(kept) == nil {
		t.Fatal("revoking one phone cut off another")
	}
	phones.RemoveAll()
	if phones.WithKey(kept) != nil || len(loadPhones().All) != 0 {
		t.Fatal("unpairing all phones left one paired")
	}
}

func TestTheHookKeyIsNotAPhoneKey(t *testing.T) {
	isolate(t)
	a := NewAccess()
	phoneKey := a.Phones.Pair("iPhone")
	if a.IsHookKey(phoneKey) || a.IsHookKey("") {
		t.Fatal("a phone's key, or none, passed as the hook's")
	}
	if !a.IsHookKey(a.HookKey) || a.Phones.WithKey(a.HookKey) != nil {
		t.Fatal("the hook key isn't the hook's alone")
	}
	if NewAccess().HookKey != a.HookKey {
		t.Fatal("the hook key changed from one start to the next")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(hookKeyFile)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("the hook key's file is %v, want readable by its owner only", info.Mode().Perm())
		}
	}
}

func TestPhoneNames(t *testing.T) {
	for userAgent, want := range map[string]string{
		iPhone: "iPhone",
		"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)":           "iPad",
		"Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0.0": "Android phone",
		"curl/8.7.1": "Phone",
	} {
		if got := phoneName(userAgent); got != want {
			t.Errorf("phoneName(%q) = %q, want %q", userAgent, got, want)
		}
	}
}
