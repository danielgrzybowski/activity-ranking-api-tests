@resilience @rankings
Feature: Behaving well when Open-Meteo does not

  The API is a thin layer over somebody else's service. When that service is
  slow, rate-limited or broken, the user needs a distinguishable answer -
  something the front end can turn into "try again in a minute" rather than a
  blank screen. These scenarios also pin down what we ask Open-Meteo for,
  because a wrong query is an outage nobody notices.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities
    And every day of the forecast for "Paris" is "PERFECT_SUMMER_DAY"

  # The list used to name five, two of which no rule consumed, while omitting
  # the gusts that decide the blizzard and storm verdicts - so the one scenario
  # guarding against a wrong upstream query would not have noticed them going
  # missing.
  Scenario: The forecast request asks for exactly what the ranking needs, once
    Every variable the ranking model reads, and nothing else.

    When I request rankings for location id "2988507"
    Then Open-Meteo's forecast service was called once
    And Open-Meteo's geocoding service was called at most once
    And the forecast request used the coordinates of "Paris"
    And the forecast request asked for 7 days
    And the forecast request asked for dates in the location's timezone
    And the forecast request asked for exactly these daily variables:
      | weather_code       |
      | temperature_2m_max |
      | precipitation_sum  |
      | snowfall_sum       |
      | wind_speed_10m_max |
      | wind_gusts_10m_max |
      | sunshine_duration  |

  Scenario: A shorter window is asked of Open-Meteo, not trimmed afterwards
    Asking Open-Meteo for seven days and throwing four away spends quota on
    nothing.

    When I request rankings for location id "2988507" over 3 days
    Then the response status is 200
    And the forecast request asked for 3 days
    And the ranking covers 3 consecutive days starting from the first forecast day

  Scenario Outline: Each way Open-Meteo can fail gets its own answer
    Given Open-Meteo's forecast service <failure>
    When I request rankings for location id "2988507"
    Then the response status is <status>
    And the error code is "<code>"
    And the response matches the error contract

    Examples:
      | failure                     | status | code                  |
      | is returning server errors  | 502    | UPSTREAM_UNAVAILABLE  |
      | is returning malformed data | 502    | UPSTREAM_UNAVAILABLE  |
      | is rate limiting            | 503    | UPSTREAM_RATE_LIMITED |
      | never responds              | 504    | UPSTREAM_TIMEOUT      |

  Scenario: Being rate-limited tells the front end when to come back
    Given Open-Meteo's forecast service is rate limiting
    When I request rankings for location id "2988507"
    Then the "retry-after" header is present

  Scenario: A hanging forecast service still answers the user quickly
    A hung upstream must not hold a user's connection open indefinitely.

    Given Open-Meteo's forecast service never responds
    When I request rankings for location id "2988507"
    Then the response arrived within the "rankings" latency budget

  Scenario: A broken geocoding service is reported as an upstream failure
    Given Open-Meteo's geocoding service is returning server errors
    When I request rankings for the city "Paris"
    Then the response status is 502
    And the error code is "UPSTREAM_UNAVAILABLE"
    And Open-Meteo's forecast service was not called

  Scenario: A short forecast is served as far as it goes, not padded
    Given Open-Meteo only has 4 days of forecast
    And every day of the forecast for "Paris" is "PERFECT_SUMMER_DAY"
    When I request rankings for location id "2988507"
    Then the response status is 200
    And the response matches the rankings contract
    And the ranking covers 4 consecutive days starting from the first forecast day
